/**
 * Music module — MP3 metadata (ID3v2 + ID3v1) and runtime estimation.
 *
 * ID3v2 lives at the front of the file and may be unsynchronised, extended or
 * footer-terminated; ID3v1 is a fixed 128-byte block at the very end and is only
 * consulted for fields ID3v2 did not provide. The runtime is *not* stored in
 * either tag, so it is recovered from the MPEG frame headers: an exact frame
 * count when the encoder wrote a Xing/Info (or VBRI) header, otherwise a
 * constant-bitrate estimate from the audio payload size.
 *
 * Everything is a pure function over a Buffer so it can be unit-tested.
 */
import type { AudioPicture, TaggedFields } from './vorbis'

export interface Mp3Info {
  fields: TaggedFields
  picture: AudioPicture | null
  /** Bytes of leading metadata to skip before the first audio frame. */
  audioOffset: number
  /** Bytes of trailing metadata (ID3v1) that are not audio. */
  trailingOffset: number
  duration: number
  bitrate?: number
  sampleRate?: number
  channels?: number
}

/** The 80 original ID3v1 genre names, plus the Winamp extensions. */
export const ID3V1_GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop',
  'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock',
  'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack',
  'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance',
  'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
  'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop',
  'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic',
  'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40',
  'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave',
  'Psychadelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk',
  'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'
]

interface FrameTables {
  bitrates: number[]
  sampleRates: number[]
  samplesPerFrame: number
}

/**
 * Bitrate tables, keyed by the header's *layer bits*.
 *
 * Those bits are inverted relative to the layer's name — `3` is Layer I, `2` is
 * Layer II and `1` is Layer III (the most common) — which is why the tables look
 * backwards. Indexing them by anything else silently reads a Layer I table for a
 * Layer III file.
 */
const BITRATES_V1: Record<number, number[]> = {
  3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], // Layer I
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], // Layer II
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] // Layer III
}
const BITRATES_V2: Record<number, number[]> = {
  3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], // Layer I
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // Layer II
  1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] // Layer III
}
/** Sample rates, keyed by the header's version bits: 3 = MPEG 1, 2 = MPEG 2, 0 = MPEG 2.5. */
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000]
}

function frameTables(versionBits: number, layerBits: number): FrameTables | null {
  const isMpeg1 = versionBits === 3
  if (versionBits !== 3 && versionBits !== 2 && versionBits !== 0) return null
  const sampleRates = SAMPLE_RATES[versionBits]
  if (!sampleRates) return null

  const table = isMpeg1 ? BITRATES_V1 : BITRATES_V2
  const bitrates = table[layerBits]
  if (!bitrates) return null

  // Layer I always packs 384 samples; Layer II always 1152; Layer III halves its
  // frame for MPEG 2 / 2.5.
  const samplesPerFrame = layerBits === 3
    ? 384
    : layerBits === 2
      ? 1152
      : isMpeg1 ? 1152 : 576

  return { bitrates, sampleRates, samplesPerFrame }
}

// ---------------------------------------------------------------- ID3v2 ----

/** Synchsafe integer: 4 bytes of 7 significant bits each. */
function synchsafe(buffer: Buffer, offset: number): number {
  return ((buffer[offset]! & 0x7F) << 21)
    | ((buffer[offset + 1]! & 0x7F) << 14)
    | ((buffer[offset + 2]! & 0x7F) << 7)
    | (buffer[offset + 3]! & 0x7F)
}

/** Undo ID3v2 unsynchronisation (`FF 00` → `FF`). */
function deunsynchronise(body: Buffer): Buffer {
  if (!body.includes(0xFF)) return body
  const out = Buffer.allocUnsafe(body.length)
  let written = 0
  for (let i = 0; i < body.length; i++) {
    const byte = body[i]!
    out[written++] = byte
    if (byte === 0xFF && body[i + 1] === 0x00) i++
  }
  return out.subarray(0, written)
}

function decodeUtf16(data: Buffer, honourBom: boolean): string {
  if (data.length < 2) return ''
  let littleEndian = true
  let start = 0
  if (honourBom) {
    if (data[0] === 0xFF && data[1] === 0xFE) {
      littleEndian = true
      start = 2
    } else if (data[0] === 0xFE && data[1] === 0xFF) {
      littleEndian = false
      start = 2
    }
  }
  const usable = data.length - start - ((data.length - start) % 2)
  if (usable <= 0) return ''
  const body = data.subarray(start, start + usable)
  if (littleEndian) return body.toString('utf16le')
  const swapped = Buffer.from(body)
  swapped.swap16()
  return swapped.toString('utf16le')
}

/** A text frame body: one encoding byte followed by the text. */
function decodeTextFrame(body: Buffer): string {
  if (!body.length) return ''
  const encoding = body[0]!
  const data = body.subarray(1)
  let text: string
  switch (encoding) {
    case 0:
      text = data.toString('latin1')
      break
    case 1:
      text = decodeUtf16(data, true)
      break
    case 2:
      text = decodeUtf16(data, false)
      break
    default:
      text = data.toString('utf8')
      break
  }
  return text.replace(/\0+$/g, '').trim()
}

/** A null-terminated string inside a frame, honouring its encoding. */
function readTerminated(data: Buffer, offset: number, encoding: number): { value: string, end: number } {
  if (encoding === 1 || encoding === 2) {
    for (let i = offset; i + 1 < data.length; i += 2) {
      if (data[i] === 0x00 && data[i + 1] === 0x00) {
        const raw = data.subarray(offset, i)
        return {
          value: (encoding === 1 ? decodeUtf16(raw, true) : decodeUtf16(raw, false)).trim(),
          end: i + 2
        }
      }
    }
    const rest = data.subarray(offset)
    return { value: (encoding === 1 ? decodeUtf16(rest, true) : decodeUtf16(rest, false)).trim(), end: data.length }
  }
  const stop = data.indexOf(0x00, offset)
  const end = stop < 0 ? data.length : stop
  const text = data.subarray(offset, end).toString(encoding === 0 ? 'latin1' : 'utf8')
  return { value: text.trim(), end: end + 1 }
}

/** `(17)` / `(17)Rock` / `Rock` → a genre name. */
function normaliseGenre(value: string): string {
  if (!value) return ''
  const numeric = value.match(/^\((\d+)\)/)
  if (numeric) {
    const index = Number.parseInt(numeric[1]!, 10)
    const rest = value.slice(numeric[0].length).trim()
    if (rest) return rest
    return ID3V1_GENRES[index] ?? ''
  }
  return value
}

interface RawFrame {
  id: string
  body: Buffer
}

/** Collect the frames of an ID3v2 tag, tolerating malformed ones. */
function readId3v2Frames(buffer: Buffer, bodyStart: number, bodyEnd: number, major: number): RawFrame[] {
  const frames: RawFrame[] = []
  const idLength = major === 2 ? 3 : 4
  const sizeLength = major === 2 ? 3 : 4
  let cursor = bodyStart

  while (cursor + idLength + sizeLength <= bodyEnd) {
    const id = buffer.toString('latin1', cursor, cursor + idLength)
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break

    let size: number
    if (major === 2) {
      size = buffer.readUIntBE(cursor + idLength, 3)
    } else if (major === 4) {
      size = synchsafe(buffer, cursor + idLength)
    } else {
      size = buffer.readUInt32BE(cursor + idLength)
    }

    let headerLength = idLength + sizeLength
    let skip = 0

    if (major >= 3) {
      const flags = buffer.readUInt16BE(cursor + idLength + sizeLength)
      headerLength += 2
      const compressed = major === 3 ? (flags & 0x0080) !== 0 : (flags & 0x0008) !== 0
      const encrypted = major === 3 ? (flags & 0x0040) !== 0 : (flags & 0x0004) !== 0
      // Grouping adds a byte, a data-length indicator adds four; both are
      // dropped because the payload we care about follows them.
      if (major === 3 && (flags & 0x0020) !== 0) skip += 1
      if (major === 4 && (flags & 0x0040) !== 0) skip += 1
      if (major === 4 && (flags & 0x0001) !== 0) skip += 4
      if (compressed || encrypted) {
        cursor += headerLength + size
        continue
      }
    }

    const start = cursor + headerLength
    const end = start + size
    if (size <= 0 || end > bodyEnd) break

    frames.push({ id, body: buffer.subarray(start + skip, end) })
    cursor = end
  }

  return frames
}

/** Extract the artist/album/title/... fields and any embedded picture. */
function fieldsFromFrames(frames: RawFrame[]): { fields: TaggedFields, picture: AudioPicture | null } {
  // v2.2 uses three-character ids; alias them onto the v2.3/2.4 names.
  const ALIASES: Record<string, string> = {
    TT2: 'TIT2', TP1: 'TPE1', TP2: 'TPE2', TAL: 'TALB', TCO: 'TCON', TRK: 'TRCK',
    TPA: 'TPOS', TYE: 'TYER', TDA: 'TDAT', ULT: 'USLT', PIC: 'APIC', COM: 'COMM'
  }

  const text = new Map<string, string>()
  let picture: AudioPicture | null = null
  let lyrics: string | undefined

  for (const frame of frames) {
    const id = ALIASES[frame.id] ?? frame.id
    const { body } = frame
    if (!body.length) continue

    if (id === 'APIC') {
      if (picture) continue
      const encoding = body[0]!
      const mime = readTerminated(body, 1, 0)
      const typeOffset = mime.end
      if (typeOffset >= body.length) continue
      const description = readTerminated(body, typeOffset + 1, encoding)
      const data = body.subarray(description.end)
      if (data.length) {
        // v2.2 stores a three-letter format instead of a MIME type.
        const resolved = mime.value.includes('/')
          ? mime.value
          : `image/${(mime.value || 'jpeg').toLowerCase() === 'jpg' ? 'jpeg' : (mime.value || 'jpeg').toLowerCase()}`
        picture = { mime: resolved, data: Buffer.from(data) }
      }
      continue
    }

    if (id === 'USLT') {
      if (lyrics === undefined) {
        // [encoding][language(3)][descriptor…][text]
        const encoding = body[0]!
        const descriptor = readTerminated(body, 4, encoding)
        lyrics = decodeTextFrame(Buffer.concat([Buffer.from([encoding]), body.subarray(descriptor.end)]))
      }
      continue
    }

    if (id.startsWith('T')) {
      const value = decodeTextFrame(body)
      if (value && !text.has(id)) text.set(id, value)
    }
  }

  const yearSource = text.get('TDRC') ?? text.get('TYER') ?? text.get('TDRL')
  const yearMatch = yearSource?.match(/(19|20)\d{2}/)

  return {
    fields: {
      title: text.get('TIT2'),
      artist: text.get('TPE1'),
      albumArtist: text.get('TPE2'),
      album: text.get('TALB'),
      genre: normaliseGenre(text.get('TCON') ?? '') || undefined,
      year: yearMatch ? Number.parseInt(yearMatch[0], 10) : undefined,
      trackNo: text.get('TRCK')?.match(/\d+/)?.[0] ? Number.parseInt(text.get('TRCK')!.match(/\d+/)![0]!, 10) : undefined,
      discNo: text.get('TPOS')?.match(/\d+/)?.[0] ? Number.parseInt(text.get('TPOS')!.match(/\d+/)![0]!, 10) : undefined,
      lyrics,
      compilation: /^(1|true|yes)$/i.test(text.get('TCMP') ?? '')
    },
    picture
  }
}

/** ID3v2 tag at `offset`; returns the end offset of the tag (or `offset`). */
function readId3v2(buffer: Buffer, offset: number): { frames: RawFrame[], end: number } | null {
  if (offset + 10 > buffer.length) return null
  if (buffer.toString('latin1', offset, offset + 3) !== 'ID3') return null

  const major = buffer[offset + 3]!
  const flags = buffer[offset + 5]!
  const declared = synchsafe(buffer, offset + 6)
  const bodyStart = offset + 10
  const bodyEnd = Math.min(bodyStart + declared, buffer.length)
  // A footer (v2.4) is another 10 bytes after the body.
  const end = Math.min(bodyEnd + ((flags & 0x10) !== 0 ? 10 : 0), buffer.length)

  let body = buffer.subarray(bodyStart, bodyEnd)
  const unsynchronised = (flags & 0x80) !== 0

  // The extended header sits between the tag header and the frames.
  let framesStart = 0
  if ((flags & 0x40) !== 0 && body.length >= 4) {
    framesStart = major === 4 ? synchsafe(body, 0) : body.readUInt32BE(0) + 4
  }
  if (unsynchronised) {
    body = deunsynchronise(body)
    framesStart = 0
  }

  const frames = readId3v2Frames(body, Math.min(framesStart, body.length), body.length, major)
  return { frames, end }
}

// ---------------------------------------------------------------- ID3v1 ----

/** The fixed 128-byte ID3v1 block at the end of the file, if present. */
function readId3v1(buffer: Buffer): TaggedFields | null {
  if (buffer.length < 128) return null
  const offset = buffer.length - 128
  if (buffer.toString('latin1', offset, offset + 3) !== 'TAG') return null

  const slice = (from: number, length: number) =>
    buffer.subarray(offset + from, offset + from + length).toString('latin1').replace(/\0.*$/s, '').trim()

  const genreIndex = buffer[offset + 127]!
  return {
    title: slice(3, 30) || undefined,
    artist: slice(33, 30) || undefined,
    album: slice(63, 30) || undefined,
    year: Number.parseInt(slice(93, 4), 10) || undefined,
    trackNo: undefined,
    discNo: undefined,
    genre: ID3V1_GENRES[genreIndex] ?? undefined,
    compilation: false
  }
}

// ------------------------------------------------------------ MPEG frames ----

interface FrameHeader {
  bitrate: number
  sampleRate: number
  padding: number
  samplesPerFrame: number
  channels: number
  frameLength: number
  versionBits: number
}

function readFrameHeader(buffer: Buffer, offset: number): FrameHeader | null {
  if (offset + 4 > buffer.length) return null
  const b0 = buffer[offset]!
  const b1 = buffer[offset + 1]!
  const b2 = buffer[offset + 2]!
  const b3 = buffer[offset + 3]!
  if (b0 !== 0xFF || (b1 & 0xE0) !== 0xE0) return null

  const versionBits = (b1 >> 3) & 0x03
  const layerBits = (b1 >> 1) & 0x03
  const bitrateIndex = (b2 >> 4) & 0x0F
  const sampleRateIndex = (b2 >> 2) & 0x03
  const padding = (b2 >> 1) & 0x01
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null

  const tables = frameTables(versionBits, layerBits)
  if (!tables) return null
  const bitrate = tables.bitrates[bitrateIndex]!
  const sampleRate = tables.sampleRates[sampleRateIndex]!
  if (!bitrate || !sampleRate) return null

  const frameLength = layerBits === 3
    ? Math.floor((12 * bitrate * 1000) / sampleRate + padding) * 4
    : Math.floor(((versionBits === 3 ? 144 : 72) * bitrate * 1000) / sampleRate) + padding
  if (frameLength <= 4) return null

  return {
    bitrate,
    sampleRate,
    padding,
    samplesPerFrame: tables.samplesPerFrame,
    channels: ((b3 >> 6) & 0x03) === 3 ? 1 : 2,
    frameLength,
    versionBits
  }
}

/** First audio frame at or after `offset` (skipping junk, up to a sane limit). */
function findFirstFrame(buffer: Buffer, offset: number): { header: FrameHeader, offset: number } | null {
  const limit = Math.min(buffer.length - 4, offset + 65536)
  for (let i = Math.max(0, offset); i < limit; i++) {
    const header = readFrameHeader(buffer, i)
    if (header) return { header, offset: i }
  }
  return null
}

interface XingInfo {
  frames?: number
  bytes?: number
}

/** The encoder's own frame/byte count, if it wrote a Xing, Info or VBRI block. */
function readEncoderHeader(buffer: Buffer, frameOffset: number, header: FrameHeader): XingInfo | null {
  const sideInfo = header.versionBits === 3
    ? (header.channels === 1 ? 17 : 32)
    : (header.channels === 1 ? 9 : 17)

  const xingOffset = frameOffset + 4 + sideInfo
  const id = buffer.toString('latin1', xingOffset, xingOffset + 4)
  if (id === 'Xing' || id === 'Info') {
    const flags = buffer.readUInt32BE(xingOffset + 4)
    let cursor = xingOffset + 8
    const info: XingInfo = {}
    if (flags & 0x01) {
      info.frames = buffer.readUInt32BE(cursor)
      cursor += 4
    }
    if (flags & 0x02) {
      info.bytes = buffer.readUInt32BE(cursor)
    }
    return info
  }

  // VBRI always sits 32 bytes after the frame header.
  const vbriOffset = frameOffset + 4 + 32
  if (buffer.toString('latin1', vbriOffset, vbriOffset + 4) === 'VBRI') {
    return {
      bytes: buffer.readUInt32BE(vbriOffset + 10),
      frames: buffer.readUInt32BE(vbriOffset + 14)
    }
  }

  return null
}

export function isMp3(buffer: Buffer): boolean {
  if (buffer.length >= 3 && buffer.toString('latin1', 0, 3) === 'ID3') return true
  return readFrameHeader(buffer, 0) !== null
}

export function parseMp3(buffer: Buffer): Mp3Info {
  let fields: TaggedFields | null = null
  let picture: AudioPicture | null = null

  let audioOffset = 0
  const tag = readId3v2(buffer, 0)
  if (tag) {
    audioOffset = tag.end
    const parsed = fieldsFromFrames(tag.frames)
    fields = parsed.fields
    picture = parsed.picture
  }

  // ID3v1 only fills gaps left by ID3v2.
  const legacy = readId3v1(buffer)
  if (legacy) {
    fields = {
      title: fields?.title ?? legacy.title,
      artist: fields?.artist ?? legacy.artist,
      albumArtist: fields?.albumArtist,
      album: fields?.album ?? legacy.album,
      genre: fields?.genre ?? legacy.genre,
      year: fields?.year ?? legacy.year,
      trackNo: fields?.trackNo,
      discNo: fields?.discNo,
      lyrics: fields?.lyrics,
      compilation: fields?.compilation ?? false
    }
  }

  const trailingOffset = buffer.length >= 128 && buffer.toString('latin1', buffer.length - 128, buffer.length - 125) === 'TAG'
    ? 128
    : 0

  const found = findFirstFrame(buffer, audioOffset)
  let duration = 0
  let bitrate: number | undefined
  let sampleRate: number | undefined
  let channels: number | undefined

  if (found) {
    const { header } = found
    bitrate = header.bitrate
    sampleRate = header.sampleRate
    channels = header.channels

    const encoder = readEncoderHeader(buffer, found.offset, header)
    if (encoder?.frames) {
      duration = (encoder.frames * header.samplesPerFrame) / header.sampleRate
    } else {
      // Constant-bitrate estimate over the audio payload.
      const audioBytes = Math.max(0, buffer.length - audioOffset - trailingOffset)
      duration = (audioBytes * 8) / (header.bitrate * 1000)
    }
  }

  return {
    fields: fields ?? {
      compilation: false
    },
    picture,
    audioOffset,
    trailingOffset,
    duration: Number.isFinite(duration) ? duration : 0,
    bitrate,
    sampleRate,
    channels
  }
}
