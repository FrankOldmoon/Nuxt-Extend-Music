/**
 * Music module — Ogg container parsing (Vorbis and Opus).
 *
 * An Ogg file is a sequence of pages; each page carries whole or partial
 * packets. The first packet of the logical stream is the identification header
 * (sample rate, channels) and the second is the comment header (the tags). The
 * runtime is *not* in any header — it comes from the granule position of the
 * last page, which counts samples at the stream's own rate (always 48 kHz for
 * Opus).
 *
 * Everything is a pure function over a Buffer so it can be unit-tested.
 */
import { parseVorbisComment, readVorbisFields, vorbisPicture, type AudioPicture, type TaggedFields } from './vorbis'

export interface OggInfo {
  /** 'vorbis' | 'opus' */
  codec: string
  fields: TaggedFields
  picture: AudioPicture | null
  duration: number
  sampleRate?: number
  channels?: number
}

/** Opus granules are always counted at 48 kHz, whatever the input rate was. */
const OPUS_GRANULE_RATE = 48000

export function isOgg(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS'
}

/**
 * Walk the pages, reassembling packets.
 *
 * A segment of 255 bytes means "the packet continues"; anything shorter
 * terminates it. A packet may therefore span several pages, so the partial
 * buffer lives outside the page loop.
 */
function* oggPackets(buffer: Buffer, limit = 8): Generator<Buffer> {
  let cursor = 0
  let parts: Buffer[] = []
  let produced = 0

  while (cursor + 27 <= buffer.length && produced < limit) {
    if (buffer.toString('ascii', cursor, cursor + 4) !== 'OggS') break
    const segments = buffer[cursor + 26]!
    const tableStart = cursor + 27
    if (tableStart + segments > buffer.length) break

    let payloadLength = 0
    for (let i = 0; i < segments; i++) payloadLength += buffer[tableStart + i]!
    const payloadStart = tableStart + segments
    if (payloadStart + payloadLength > buffer.length) break

    let offset = payloadStart
    for (let i = 0; i < segments; i++) {
      const size = buffer[tableStart + i]!
      parts.push(buffer.subarray(offset, offset + size))
      offset += size
      if (size < 255) {
        yield Buffer.concat(parts)
        parts = []
        produced++
      }
    }

    cursor = payloadStart + payloadLength
  }

  if (parts.length && produced < limit) yield Buffer.concat(parts)
}

/**
 * Granule position of the last complete page.
 *
 * An all-ones granule means "no packet finishes on this page", so the scan
 * keeps walking backwards until it finds a usable one.
 */
function lastGranule(buffer: Buffer): number | null {
  const earliest = Math.max(0, buffer.length - 65536)
  for (let i = buffer.length - 27; i >= earliest; i--) {
    if (buffer[i] !== 0x4F || buffer[i + 1] !== 0x67 || buffer[i + 2] !== 0x67 || buffer[i + 3] !== 0x53) continue
    const low = buffer.readUInt32LE(i + 6)
    const high = buffer.readUInt32LE(i + 10)
    if (low === 0xFFFFFFFF && high === 0xFFFFFFFF) continue
    return high * 4294967296 + low
  }
  return null
}

/** Read the codec's identification header. */
function readIdentification(packet: Buffer): { codec: string, sampleRate?: number, channels?: number } | null {
  if (packet.length >= 16 && packet[0] === 0x01 && packet.toString('ascii', 1, 7) === 'vorbis') {
    return {
      codec: 'vorbis',
      channels: packet[11],
      sampleRate: packet.readUInt32LE(12)
    }
  }
  if (packet.length >= 19 && packet.toString('ascii', 0, 8) === 'OpusHead') {
    return {
      codec: 'opus',
      channels: packet[9],
      sampleRate: packet.readUInt32LE(12) || OPUS_GRANULE_RATE
    }
  }
  return null
}

export function parseOgg(buffer: Buffer): OggInfo | null {
  if (!isOgg(buffer)) return null

  let identification: { codec: string, sampleRate?: number, channels?: number } | null = null
  let fields: TaggedFields | null = null
  let picture: AudioPicture | null = null

  for (const packet of oggPackets(buffer)) {
    if (!identification) {
      identification = readIdentification(packet)
      if (!identification) return null
      continue
    }
    // Comment header: `\x03vorbis` + comment (Vorbis) / `OpusTags` + comment (Opus).
    const isVorbisComment = packet.length >= 7 && packet[0] === 0x03 && packet.toString('ascii', 1, 7) === 'vorbis'
    const isOpusComment = packet.length >= 8 && packet.toString('ascii', 0, 8) === 'OpusTags'
    if (isVorbisComment || isOpusComment) {
      const offset = isVorbisComment ? 7 : 8
      const { tags } = parseVorbisComment(packet, offset)
      fields = readVorbisFields(tags)
      picture = vorbisPicture(tags)
    }
    if (fields) break
  }

  if (!identification || !fields) return null

  const granule = lastGranule(buffer)
  // Vorbis granules are in samples; Opus granules are always at 48 kHz.
  const granuleRate = identification.codec === 'opus' ? OPUS_GRANULE_RATE : identification.sampleRate
  const duration = granule && granuleRate ? granule / granuleRate : 0

  return {
    codec: identification.codec,
    fields,
    picture,
    duration,
    sampleRate: identification.sampleRate,
    channels: identification.channels
  }
}
