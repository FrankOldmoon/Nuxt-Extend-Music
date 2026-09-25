/**
 * Music module — synthetic audio fixtures for the tag-parser tests.
 *
 * Every container is built byte by byte here rather than committed as a binary,
 * so the tests document the exact layouts the parsers must handle (and the
 * fixtures stay diffable in review).
 */

/** Box/packet payloads are kept small so a page/segment table stays trivial. */
function id3v2Frame(id: string, body: Buffer): Buffer {
  const header = Buffer.alloc(10 + body.length)
  header.write(id, 0, 'latin1')
  header.writeUInt32BE(body.length, 4)
  body.copy(header, 10)
  return header
}

function id3TextFrame(id: string, text: string, encoding: 0 | 3 = 3): Buffer {
  const textBytes = Buffer.from(text, encoding === 0 ? 'latin1' : 'utf8')
  return id3v2Frame(id, Buffer.concat([Buffer.from([encoding]), textBytes]))
}

function id3ApicFrame(mime: string, data: Buffer): Buffer {
  return id3v2Frame('APIC', Buffer.concat([
    Buffer.from([0]), // encoding: latin1
    Buffer.from(`${mime}\0`, 'latin1'),
    Buffer.from([3]), // picture type: front cover
    Buffer.from([0]), // empty description
    data
  ]))
}

/** USLT is `[encoding][language(3)][descriptor][text]`. */
function id3LyricsFrame(text: string, language = 'eng'): Buffer {
  return id3v2Frame('USLT', Buffer.concat([
    Buffer.from([3]), // UTF-8
    Buffer.from(language, 'latin1'),
    Buffer.from([0]), // empty content descriptor
    Buffer.from(text, 'utf8')
  ]))
}

/** A valid MPEG-1 Layer III frame header: 128 kbps, 44.1 kHz, stereo. */
const MP3_FRAME_HEADER = Buffer.from([0xFF, 0xFB, 0x90, 0x00])
const MP3_FRAME_LENGTH = Math.floor((144 * 128000) / 44100) // 417

export interface Mp3FixtureOptions {
  /** Frame count written into a Xing header; omit for a plain CBR file. */
  xingFrames?: number
  /** Number of audio frames appended after the tag. */
  frameCount?: number
  picture?: Buffer
}

export function buildMp3(options: Mp3FixtureOptions = {}): Buffer {
  const frameCount = options.frameCount ?? 4
  const frames: Buffer[] = []

  for (let i = 0; i < frameCount; i++) {
    const frame = Buffer.alloc(MP3_FRAME_LENGTH)
    MP3_FRAME_HEADER.copy(frame, 0)
    if (i === 0 && options.xingFrames) {
      // Xing sits right after the side information (32 bytes for MPEG-1 stereo).
      const offset = 4 + 32
      frame.write('Xing', offset, 'latin1')
      frame.writeUInt32BE(0x00000001, offset + 4) // flags: frame count present
      frame.writeUInt32BE(options.xingFrames, offset + 8)
    }
    frames.push(frame)
  }

  const body = Buffer.concat([
    id3TextFrame('TIT2', '夜航西飞'),
    id3TextFrame('TPE1', 'Test Artist'),
    id3TextFrame('TALB', 'Test Album'),
    id3TextFrame('TPE2', 'Test Album Artist'),
    id3TextFrame('TCON', '(17)'),
    id3TextFrame('TRCK', '3/12'),
    id3TextFrame('TPOS', '1/2'),
    id3TextFrame('TYER', '1998'),
    id3LyricsFrame('First line\nSecond line'),
    ...(options.picture ? [id3ApicFrame('image/png', options.picture)] : [])
  ])

  // Synchsafe tag size.
  const size = body.length
  const header = Buffer.alloc(10)
  header.write('ID3', 0, 'latin1')
  header[3] = 3 // major version
  header[4] = 0 // revision
  header[5] = 0 // flags
  header[6] = (size >> 21) & 0x7F
  header[7] = (size >> 14) & 0x7F
  header[8] = (size >> 7) & 0x7F
  header[9] = size & 0x7F

  return Buffer.concat([header, body, ...frames])
}

export const MP3_CBR_AUDIO_BYTES = MP3_FRAME_LENGTH * 4

// ------------------------------------------------------------------ FLAC ----

function flacBlock(type: number, data: Buffer, isLast: boolean): Buffer {
  const header = Buffer.alloc(4)
  header[0] = (isLast ? 0x80 : 0x00) | (type & 0x7F)
  header.writeUIntBE(data.length, 1, 3)
  return Buffer.concat([header, data])
}

function flacStreamInfo(sampleRate: number, channels: number, bitsPerSample: number, totalSamples: number): Buffer {
  const data = Buffer.alloc(34)
  data.writeUInt16BE(4096, 0) // min block size
  data.writeUInt16BE(4096, 2) // max block size
  // min/max frame size stay zero.
  const high = (sampleRate << 12) | ((channels - 1) << 9) | ((bitsPerSample - 1) << 4)
    | Math.floor(totalSamples / 4294967296)
  const low = totalSamples % 4294967296
  data.writeUInt32BE(high >>> 0, 10)
  data.writeUInt32BE(low >>> 0, 14)
  return data
}

function vorbisCommentBlock(fields: Array<[string, string]>): Buffer {
  const vendor = Buffer.from('music-module-test', 'utf8')
  const parts: Buffer[] = []
  const vendorLength = Buffer.alloc(4)
  vendorLength.writeUInt32LE(vendor.length)
  parts.push(vendorLength, vendor)

  const count = Buffer.alloc(4)
  count.writeUInt32LE(fields.length)
  parts.push(count)

  for (const [key, value] of fields) {
    const entry = Buffer.from(`${key}=${value}`, 'utf8')
    const length = Buffer.alloc(4)
    length.writeUInt32LE(entry.length)
    parts.push(length, entry)
  }
  return Buffer.concat(parts)
}

function flacPictureBlock(mime: string, data: Buffer): Buffer {
  const parts: Buffer[] = []
  const u32 = (value: number) => {
    const buffer = Buffer.alloc(4)
    buffer.writeUInt32LE(value)
    return buffer
  }
  parts.push(u32(3)) // picture type: front cover
  const mimeBytes = Buffer.from(mime, 'ascii')
  parts.push(u32(mimeBytes.length), mimeBytes)
  parts.push(u32(0)) // empty description
  parts.push(u32(0), u32(0), u32(0), u32(0)) // width, height, depth, colours
  parts.push(u32(data.length), data)
  return Buffer.concat(parts)
}

export interface FlacFixtureOptions {
  sampleRate?: number
  channels?: number
  bitsPerSample?: number
  totalSamples?: number
  fields?: Array<[string, string]>
  picture?: Buffer
}

export function buildFlac(options: FlacFixtureOptions = {}): Buffer {
  const sampleRate = options.sampleRate ?? 44100
  const channels = options.channels ?? 2
  const bitsPerSample = options.bitsPerSample ?? 16
  const totalSamples = options.totalSamples ?? sampleRate * 2
  const fields = options.fields ?? [
    ['TITLE', 'Flac Title'],
    ['ARTIST', 'Flac Artist'],
    ['ALBUM', 'Flac Album'],
    ['ALBUMARTIST', 'Flac Album Artist'],
    ['GENRE', 'Jazz'],
    ['DATE', '2001-03-04'],
    ['TRACKNUMBER', '7'],
    ['DISCNUMBER', '2'],
    ['LYRICS', 'flac lyrics']
  ]

  const blocks = [
    flacBlock(0, flacStreamInfo(sampleRate, channels, bitsPerSample, totalSamples), false),
    flacBlock(4, vorbisCommentBlock(fields), !options.picture),
    ...(options.picture ? [flacBlock(6, flacPictureBlock('image/png', options.picture), true)] : [])
  ]

  return Buffer.concat([Buffer.from('fLaC', 'ascii'), ...blocks])
}

// ------------------------------------------------------------------- M4A ----

function mp4Box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload)
  const header = Buffer.alloc(8)
  header.writeUInt32BE(body.length + 8, 0)
  header.write(type, 4, 'latin1')
  return Buffer.concat([header, body])
}

/** An `ilst` item: a typed item box holding one `data` box. */
function mp4Item(type: string, wellKnown: number, payload: Buffer): Buffer {
  return mp4Box(type, mp4Box('data', Buffer.concat([Buffer.from([wellKnown, 0, 0, 0]), payload])))
}

export interface M4aFixtureOptions {
  timescale?: number
  duration?: number
  title?: string
  withCover?: boolean
}

export function buildM4a(options: M4aFixtureOptions = {}): Buffer {
  const timescale = options.timescale ?? 1000
  const duration = options.duration ?? 180000

  const mvhdBody = Buffer.alloc(100)
  mvhdBody.writeUInt32BE(timescale, 12)
  mvhdBody.writeUInt32BE(duration, 16)

  const items = [
    mp4Item('\u00A9nam', 1, Buffer.from(options.title ?? 'M4A Title', 'utf8')),
    mp4Item('\u00A9ART', 1, Buffer.from('M4A Artist', 'utf8')),
    mp4Item('aART', 1, Buffer.from('M4A Album Artist', 'utf8')),
    mp4Item('\u00A9alb', 1, Buffer.from('M4A Album', 'utf8')),
    mp4Item('\u00A9gen', 1, Buffer.from('Electronic', 'utf8')),
    mp4Item('\u00A9day', 1, Buffer.from('2019-07-01', 'utf8')),
    mp4Item('\u00A9lyr', 1, Buffer.from('m4a lyrics', 'utf8')),
    mp4Item('trkn', 0, Buffer.from([0, 0, 0, 5, 0, 10])),
    mp4Item('disk', 0, Buffer.from([0, 0, 0, 2, 0, 3])),
    mp4Item('cpil', 21, Buffer.from([1])),
    ...(options.withCover === false ? [] : [mp4Item('covr', 14, Buffer.from([0x89, 0x50, 0x4E, 0x47]))])
  ]

  return Buffer.concat([
    mp4Box('ftyp', Buffer.from('M4A ', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('M4A mp42isom', 'latin1')),
    mp4Box('moov', mp4Box('mvhd', mvhdBody), mp4Box('udta', mp4Box('meta', Buffer.from([0, 0, 0, 0]), mp4Box('ilst', ...items))))
  ])
}

// ------------------------------------------------------------------- OGG ----

/** One Ogg page with a single segment (all test payloads are < 255 bytes). */
function oggPage(payload: Buffer, granule: number, sequence: number, headerType = 0): Buffer {
  const header = Buffer.alloc(27 + 1)
  header.write('OggS', 0, 'latin1')
  header[4] = 0 // version
  header[5] = headerType
  header.writeUInt32LE(granule % 4294967296, 6)
  header.writeUInt32LE(Math.floor(granule / 4294967296), 10)
  header.writeUInt32LE(0x1234, 14) // serial
  header.writeUInt32LE(sequence, 18)
  header.writeUInt32LE(0, 22) // checksum: not validated by the parser
  header[26] = 1 // one segment
  header[27] = payload.length
  return Buffer.concat([header, payload])
}

function oggVorbisIdPacket(sampleRate: number, channels: number): Buffer {
  const packet = Buffer.alloc(30)
  packet[0] = 0x01
  packet.write('vorbis', 1, 'latin1')
  packet.writeUInt32LE(0, 7) // vorbis version
  packet[11] = channels
  packet.writeUInt32LE(sampleRate, 12)
  packet.writeUInt32LE(0, 16) // bitrate max
  packet.writeUInt32LE(128000, 20) // bitrate nominal
  packet.writeUInt32LE(0, 24) // bitrate min
  packet[28] = 0xB8 // block sizes
  packet[29] = 0x01 // framing
  return packet
}

function oggOpusHeadPacket(channels: number, inputSampleRate: number): Buffer {
  const packet = Buffer.alloc(19)
  packet.write('OpusHead', 0, 'latin1')
  packet[8] = 1 // version
  packet[9] = channels
  packet.writeUInt16LE(312, 10) // pre-skip
  packet.writeUInt32LE(inputSampleRate, 12)
  packet[16] = 0 // output gain
  packet[17] = 0 // channel mapping family
  return packet
}

export interface OggFixtureOptions {
  codec?: 'vorbis' | 'opus'
  sampleRate?: number
  channels?: number
  granule?: number
  fields?: Array<[string, string]>
}

export function buildOgg(options: OggFixtureOptions = {}): Buffer {
  const codec = options.codec ?? 'vorbis'
  const sampleRate = options.sampleRate ?? 44100
  const channels = options.channels ?? 2
  const granule = options.granule ?? sampleRate * 2
  const fields = options.fields ?? [
    ['TITLE', 'Ogg Title'],
    ['ARTIST', 'Ogg Artist'],
    ['ALBUM', 'Ogg Album'],
    ['GENRE', 'Rock'],
    ['DATE', '2011'],
    ['TRACKNUMBER', '9']
  ]

  const identification = codec === 'opus'
    ? oggOpusHeadPacket(channels, sampleRate)
    : oggVorbisIdPacket(sampleRate, channels)

  const commentBody = vorbisCommentBlock(fields)
  const commentPacket = codec === 'opus'
    ? Buffer.concat([Buffer.from('OpusTags', 'ascii'), commentBody])
    : Buffer.concat([Buffer.from([0x03]), Buffer.from('vorbis', 'ascii'), commentBody])

  return Buffer.concat([
    oggPage(identification, 0, 0, 0x02),
    oggPage(commentPacket, 0, 1),
    oggPage(Buffer.from([0x00]), granule, 2)
  ])
}
