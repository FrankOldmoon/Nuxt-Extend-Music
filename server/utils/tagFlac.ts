/**
 * Music module — FLAC container parsing.
 *
 * A FLAC file is `fLaC` followed by metadata blocks (`STREAMINFO`,
 * `VORBIS_COMMENT`, `PICTURE`, …) and then the audio frames. Only the metadata
 * is decoded here; the audio itself is streamed untouched.
 *
 * Everything is a pure function over a Buffer so it can be unit-tested.
 */
import {
  parseFlacPicture,
  parseVorbisComment,
  readVorbisFields,
  vorbisPicture,
  type AudioPicture,
  type TaggedFields,
  type VorbisTags
} from './vorbis'

export interface FlacInfo {
  fields: TaggedFields
  picture: AudioPicture | null
  /** Seconds; 0 when STREAMINFO was missing or total samples were unset. */
  duration: number
  bitrate?: number
  sampleRate?: number
  channels?: number
  bitsPerSample?: number
  totalSamples?: number
}

const BLOCK_STREAMINFO = 0
const BLOCK_VORBIS_COMMENT = 4
const BLOCK_PICTURE = 6

interface StreamInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  totalSamples: number
}

/**
 * STREAMINFO packs sample rate, channel count, bit depth and total sample count
 * into one 64-bit big-endian word starting at byte 10.
 */
function readStreamInfo(buffer: Buffer, offset: number): StreamInfo | null {
  if (offset + 34 > buffer.length) return null
  const high = buffer.readUInt32BE(offset + 10)
  const low = buffer.readUInt32BE(offset + 14)
  return {
    sampleRate: high >>> 12,
    channels: ((high >>> 9) & 0x07) + 1,
    bitsPerSample: ((high >>> 4) & 0x1F) + 1,
    // 36 bits: the low 4 bits of `high` plus all 32 bits of `low`.
    totalSamples: (high & 0x0F) * 4294967296 + low
  }
}

export function isFlac(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'fLaC'
}

export function parseFlac(buffer: Buffer): FlacInfo | null {
  if (!isFlac(buffer)) return null

  let tags: VorbisTags = new Map()
  let picture: AudioPicture | null = null
  let streamInfo: StreamInfo | null = null

  let cursor = 4
  while (cursor + 4 <= buffer.length) {
    const header = buffer[cursor]!
    const isLast = (header & 0x80) !== 0
    const type = header & 0x7F
    const length = buffer.readUIntBE(cursor + 1, 3)
    const start = cursor + 4
    const end = start + length
    if (end > buffer.length) break

    if (type === BLOCK_STREAMINFO) {
      streamInfo = readStreamInfo(buffer, start)
    } else if (type === BLOCK_VORBIS_COMMENT) {
      tags = parseVorbisComment(buffer, start).tags
    } else if (type === BLOCK_PICTURE) {
      picture = picture ?? parseFlacPicture(buffer, start).picture
    }

    cursor = end
    if (isLast) break
  }

  const sampleRate = streamInfo?.sampleRate || undefined
  const totalSamples = streamInfo?.totalSamples || undefined

  return {
    fields: readVorbisFields(tags),
    picture: picture ?? vorbisPicture(tags),
    duration: sampleRate && totalSamples ? totalSamples / sampleRate : 0,
    sampleRate,
    channels: streamInfo?.channels,
    bitsPerSample: streamInfo?.bitsPerSample,
    totalSamples,
    bitrate: sampleRate && streamInfo?.bitsPerSample && streamInfo?.channels
      ? sampleRate * streamInfo.bitsPerSample * streamInfo.channels
      : undefined
  }
}
