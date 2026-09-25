/**
 * Music module — MP4 / M4A metadata parsing.
 *
 * An MP4 file is a tree of length-prefixed boxes. The tags live in
 * `moov.udta.meta.ilst`, where each item box (`©nam`, `©ART`, `covr`, …) holds
 * one or more `data` boxes carrying a well-known payload type. The runtime comes
 * from the movie header (`moov.mvhd`), which stores a duration in units of its
 * own timescale.
 *
 * Everything is a pure function over a Buffer so it can be unit-tested.
 */
import { ID3V1_GENRES } from './tagId3'
import { parseYear, type AudioPicture, type TaggedFields } from './vorbis'

export interface Mp4Info {
  fields: TaggedFields
  picture: AudioPicture | null
  duration: number
  bitrate?: number
  sampleRate?: number
  channels?: number
}

/** `©nam` and friends: the copyright sign is the single byte 0xA9. */
const COPYRIGHT = '\u00A9'

/** Text tag keys, mapped onto the catalogue's field names. */
const TEXT_KEYS: Record<string, string> = {
  [`${COPYRIGHT}nam`]: 'title',
  [`${COPYRIGHT}ART`]: 'artist',
  aART: 'albumArtist',
  [`${COPYRIGHT}alb`]: 'album',
  [`${COPYRIGHT}gen`]: 'genre',
  [`${COPYRIGHT}day`]: 'year',
  [`${COPYRIGHT}lyr`]: 'lyrics'
}

interface Box {
  type: string
  dataStart: number
  end: number
}

/** Walk the sibling boxes in `[start, end)`, tolerating truncated ones. */
function readBoxes(buffer: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = []
  let cursor = start
  while (cursor + 8 <= end) {
    let size = buffer.readUInt32BE(cursor)
    const type = buffer.toString('latin1', cursor + 4, cursor + 8)
    let dataStart = cursor + 8

    if (size === 1) {
      if (dataStart + 8 > end) break
      size = buffer.readUInt32BE(dataStart) * 4294967296 + buffer.readUInt32BE(dataStart + 4)
      dataStart += 8
    } else if (size === 0) {
      size = end - cursor
    }

    if (size < 8 || cursor + size > end) break
    boxes.push({ type, dataStart, end: cursor + size })
    cursor += size
  }
  return boxes
}

function findBox(buffer: Buffer, boxes: Box[], type: string): Box | undefined {
  return boxes.find(box => box.type === type)
}

/** `moov.mvhd` → duration in seconds. */
function readMovieHeader(buffer: Buffer, moov: Box): { duration: number } {
  const headers = readBoxes(buffer, moov.dataStart, moov.end)
  const mvhd = findBox(buffer, headers, 'mvhd')
  if (!mvhd) return { duration: 0 }

  // NOTE: `mvhd` measures the whole media, *including* the AAC encoder priming
  // (~2112 samples, so ~96 ms at 22.05 kHz) — measurably longer than the audible
  // duration that tools like `afinfo` and a browser's media element report. The
  // exact value would need the `edts`/`elst` edit list; the error is a tenth of a
  // second, and the player replaces this estimate with the element's own duration
  // as soon as playback begins, so it is left alone deliberately.
  const version = buffer[mvhd.dataStart]!
  if (version === 1) {
    const timescale = buffer.readUInt32BE(mvhd.dataStart + 4 + 16)
    const duration = buffer.readUInt32BE(mvhd.dataStart + 4 + 20) * 4294967296
      + buffer.readUInt32BE(mvhd.dataStart + 4 + 24)
    return { duration: timescale ? duration / timescale : 0 }
  }
  const timescale = buffer.readUInt32BE(mvhd.dataStart + 4 + 8)
  const duration = buffer.readUInt32BE(mvhd.dataStart + 4 + 12)
  return { duration: timescale ? duration / timescale : 0 }
}

interface ItemValue {
  wellKnown: number
  payload: Buffer
}

/** Find `ilst` under `udta.meta` (or directly under `moov`). */
function findItemList(buffer: Buffer, moov: Box): Box | undefined {
  const moovChildren = readBoxes(buffer, moov.dataStart, moov.end)
  const candidates: Box[] = []
  const udta = findBox(buffer, moovChildren, 'udta')
  if (udta) candidates.push(...readBoxes(buffer, udta.dataStart, udta.end))
  candidates.push(...moovChildren)

  for (const meta of candidates.filter(box => box.type === 'meta')) {
    // `meta` is a full box: four bytes of version/flags before its children.
    const children = readBoxes(buffer, meta.dataStart + 4, meta.end)
    const ilst = findBox(buffer, children, 'ilst')
    if (ilst) return ilst
  }
  return undefined
}

function textValue(item: ItemValue): string {
  // Well-known type 1 is UTF-8, 2 is UTF-16; everything else is decoded as UTF-8
  // because that is what the encoders that write anything else actually mean.
  return item.payload.toString('utf8').replace(/\0+$/g, '').trim()
}

function integerValue(item: ItemValue): number | undefined {
  if (item.payload.length >= 8) return item.payload.readUInt32BE(4)
  if (item.payload.length >= 4) return item.payload.readUInt32BE(0)
  if (item.payload.length >= 2) return item.payload.readUInt16BE(0)
  if (item.payload.length === 1) return item.payload[0]
  return undefined
}

export function isMp4(buffer: Buffer): boolean {
  if (buffer.length < 12) return false
  const type = buffer.toString('latin1', 4, 8)
  if (type !== 'ftyp') {
    // Some files carry a leading `free`/`wide` box before `ftyp`.
    return buffer.toString('latin1', 12, 16) === 'ftyp'
  }
  return true
}

export function parseMp4(buffer: Buffer): Mp4Info | null {
  const top = readBoxes(buffer, 0, buffer.length)
  const moov = findBox(buffer, top, 'moov')
  if (!moov) return null

  const { duration } = readMovieHeader(buffer, moov)

  const tags = new Map<string, string>()
  let numericGenre: number | undefined
  let trackNo: number | undefined
  let discNo: number | undefined
  let compilation = false
  let picture: AudioPicture | null = null

  const ilst = findItemList(buffer, moov)
  for (const item of ilst ? readBoxes(buffer, ilst.dataStart, ilst.end) : []) {
    const dataBox = readBoxes(buffer, item.dataStart, item.end).find(box => box.type === 'data')
    if (!dataBox) continue
    const wellKnown = buffer[dataBox.dataStart]!
    const payload = buffer.subarray(dataBox.dataStart + 4, dataBox.end)
    if (!payload.length) continue
    const value: ItemValue = { wellKnown, payload }

    if (item.type === 'gnre') {
      numericGenre = integerValue(value)
    } else if (item.type === 'trkn') {
      // `trkn` is binary: two reserved bytes, then track, then total.
      trackNo = payload.length >= 4 ? payload.readUInt16BE(2) : undefined
    } else if (item.type === 'disk') {
      discNo = payload.length >= 4 ? payload.readUInt16BE(2) : undefined
    } else if (item.type === 'cpil') {
      compilation = (integerValue(value) ?? 0) !== 0
    } else if (item.type === 'covr') {
      if (!picture) {
        picture = {
          mime: wellKnown === 14 ? 'image/png' : 'image/jpeg',
          data: Buffer.from(payload)
        }
      }
    } else {
      const key = TEXT_KEYS[item.type]
      if (key) tags.set(key, textValue(value))
    }
  }

  // `gnre` stores a 1-based index into the ID3v1 genre list.
  const genre = tags.get('genre')
    ?? (numericGenre && numericGenre > 0 ? ID3V1_GENRES[numericGenre - 1] : undefined)

  return {
    duration: Number.isFinite(duration) ? duration : 0,
    picture,
    fields: {
      title: tags.get('title'),
      artist: tags.get('artist'),
      albumArtist: tags.get('albumArtist'),
      album: tags.get('album'),
      genre,
      year: parseYear(tags.get('year')),
      trackNo: trackNo || undefined,
      discNo: discNo || undefined,
      lyrics: tags.get('lyrics'),
      compilation
    }
  }
}
