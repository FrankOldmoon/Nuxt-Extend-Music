/**
 * Music module — Vorbis comment + FLAC picture parsing.
 *
 * Shared by FLAC (where the comment is a metadata block) and Ogg Vorbis/Opus
 * (where it is the second header packet). Both use the same little-endian
 * layout: vendor length + vendor, then a count followed by that many
 * `LENGTH + "KEY=value"` pairs. Keys are case-insensitive, so they are
 * upper-cased and repeated keys keep every value in order.
 *
 * Everything here is a pure function over a Buffer so it can be unit-tested
 * without a real audio file.
 */

export interface AudioPicture {
  mime: string
  data: Buffer
}

export type VorbisTags = Map<string, string[]>

/** Little-endian uint32 that returns -1 instead of throwing past the end. */
function readUInt32LE(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > buffer.length) return -1
  return buffer.readUInt32LE(offset)
}

export function parseVorbisComment(buffer: Buffer, offset: number): { tags: VorbisTags, end: number } {
  const tags: VorbisTags = new Map()
  const vendorLength = readUInt32LE(buffer, offset)
  if (vendorLength < 0) return { tags, end: offset }

  let cursor = offset + 4 + vendorLength
  const count = readUInt32LE(buffer, cursor)
  if (count < 0) return { tags, end: offset }
  cursor += 4

  for (let i = 0; i < count; i++) {
    const length = readUInt32LE(buffer, cursor)
    if (length < 0) break
    cursor += 4
    if (cursor + length > buffer.length) break
    const entry = buffer.toString('utf8', cursor, cursor + length)
    cursor += length

    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    const key = entry.slice(0, separator).trim().toUpperCase()
    const value = entry.slice(separator + 1).trim()
    if (!key || !value) continue

    const list = tags.get(key)
    if (list) list.push(value)
    else tags.set(key, [value])
  }

  return { tags, end: cursor }
}

/**
 * A FLAC `PICTURE` metadata block (also what `METADATA_BLOCK_PICTURE` carries
 * base64-encoded inside a Vorbis comment).
 */
export function parseFlacPicture(buffer: Buffer, offset: number): { picture: AudioPicture | null, end: number } {
  const pictureType = readUInt32LE(buffer, offset)
  if (pictureType < 0) return { picture: null, end: offset }
  let cursor = offset + 4

  const mimeLength = readUInt32LE(buffer, cursor)
  if (mimeLength < 0) return { picture: null, end: offset }
  cursor += 4
  const mime = buffer.toString('ascii', cursor, cursor + mimeLength)
  cursor += mimeLength

  const descriptionLength = readUInt32LE(buffer, cursor)
  if (descriptionLength < 0) return { picture: null, end: offset }
  cursor += 4 + descriptionLength

  // width, height, colour depth, palette size — not needed for display.
  cursor += 16

  const dataLength = readUInt32LE(buffer, cursor)
  if (dataLength < 0) return { picture: null, end: offset }
  cursor += 4
  if (dataLength === 0 || cursor + dataLength > buffer.length) return { picture: null, end: offset }

  return {
    picture: { mime: mime || 'image/jpeg', data: Buffer.from(buffer.subarray(cursor, cursor + dataLength)) },
    end: cursor + dataLength
  }
}

/**
 * Decode a `METADATA_BLOCK_PICTURE` value (base64 of a FLAC picture block).
 * Returns null for anything malformed — artwork is never worth failing a scan.
 */
export function parseBase64Picture(value: string | undefined): AudioPicture | null {
  if (!value) return null
  try {
    const raw = Buffer.from(value, 'base64')
    if (raw.length < 8) return null
    return parseFlacPicture(raw, 0).picture
  } catch {
    return null
  }
}

/** First value of `key`, or undefined. */
export function firstTag(tags: VorbisTags, key: string): string | undefined {
  return tags.get(key)?.[0]
}

/** Every value of `key` joined for display (multiple ARTIST fields are common). */
export function joinedTag(tags: VorbisTags, key: string): string | undefined {
  const list = tags.get(key)
  if (!list?.length) return undefined
  return [...new Set(list)].join(', ')
}

/** Parse `"3/12"`, `"3"` or `"A1"` into a number; undefined when there is none. */
export function parseTrackNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = value.match(/\d+/)
  if (!match) return undefined
  const parsed = Number.parseInt(match[0], 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

/** Parse a year out of `"1998"`, `"1998-05-01"` or `"1998/05"`. */
export function parseYear(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = value.match(/(19|20)\d{2}/)
  if (!match) return undefined
  const parsed = Number.parseInt(match[0], 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** The fields the catalogue cares about, already normalised. */
export interface TaggedFields {
  title?: string
  artist?: string
  albumArtist?: string
  album?: string
  genre?: string
  year?: number
  trackNo?: number
  discNo?: number
  lyrics?: string
  compilation: boolean
}

/**
 * Map a Vorbis comment set onto the catalogue's fields.
 *
 * Used for both FLAC and Ogg, so tag spelling differences only have to be
 * handled once (`ALBUMARTIST` / `ALBUM ARTIST` / `ALBUM_ARTIST` are all in the
 * wild, as are `LYRICS` and `UNSYNCEDLYRICS`).
 */
export function readVorbisFields(tags: VorbisTags): TaggedFields {
  return {
    title: firstTag(tags, 'TITLE'),
    artist: joinedTag(tags, 'ARTIST'),
    albumArtist: firstTag(tags, 'ALBUMARTIST')
      ?? firstTag(tags, 'ALBUM ARTIST')
      ?? firstTag(tags, 'ALBUM_ARTIST'),
    album: firstTag(tags, 'ALBUM'),
    genre: joinedTag(tags, 'GENRE'),
    year: parseYear(firstTag(tags, 'DATE') ?? firstTag(tags, 'YEAR') ?? firstTag(tags, 'ORIGINALDATE')),
    trackNo: parseTrackNumber(firstTag(tags, 'TRACKNUMBER')),
    discNo: parseTrackNumber(firstTag(tags, 'DISCNUMBER')),
    lyrics: firstTag(tags, 'LYRICS') ?? firstTag(tags, 'UNSYNCEDLYRICS') ?? firstTag(tags, 'UNSYNCED LYRICS'),
    compilation: /^(1|true|yes)$/i.test(firstTag(tags, 'COMPILATION') ?? '')
  }
}

/** Artwork carried base64-encoded inside a Vorbis comment, if any. */
export function vorbisPicture(tags: VorbisTags): AudioPicture | null {
  return parseBase64Picture(firstTag(tags, 'METADATA_BLOCK_PICTURE'))
}
