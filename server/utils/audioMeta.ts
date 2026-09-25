/**
 * Music module — audio format sniffing and metadata extraction.
 *
 * The single entry point the rest of the module uses: it sniffs the container
 * from magic bytes (falling back to the file extension), dispatches to the
 * format-specific parser, and normalises the result into one shape. Every parser
 * is a pure function over a Buffer, so the whole path is unit-testable without
 * any audio hardware or external tools — this module ships no dependencies.
 */
import { parseFlac } from './tagFlac'
import { isMp3, parseMp3 } from './tagId3'
import { isMp4, parseMp4 } from './tagMp4'
import { isOgg, parseOgg } from './tagOgg'
import type { AudioPicture, TaggedFields } from './vorbis'

export const AUDIO_FORMATS = ['mp3', 'flac', 'm4a', 'ogg'] as const
export type AudioFormat = typeof AUDIO_FORMATS[number]

/** Extensions we accept for upload, mapped onto the containers we can parse. */
const EXTENSION_FORMATS: Record<string, AudioFormat> = {
  mp3: 'mp3',
  mp2: 'mp3',
  flac: 'flac',
  m4a: 'm4a',
  m4b: 'm4a',
  mp4: 'm4a',
  aac: 'm4a',
  ogg: 'ogg',
  oga: 'ogg',
  opus: 'ogg'
}

const FORMAT_MIME: Record<AudioFormat, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg'
}

/** Container MIME type for playback, keyed by extension. */
export function audioMimeType(filename: string): string | null {
  const format = formatFromExtension(filename)
  return format ? FORMAT_MIME[format] : null
}

/** MIME type for a known container. */
export function mimeForFormat(format: AudioFormat | string): string {
  return FORMAT_MIME[format as AudioFormat] ?? 'application/octet-stream'
}

export function audioExtension(filename: string): string {
  const match = String(filename ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return match ? match[1]! : ''
}

/** Whether the extension is one we accept, regardless of whether we can tag it. */
export function isSupportedAudio(filename: string): boolean {
  return audioExtension(filename) in EXTENSION_FORMATS
}

function formatFromExtension(filename: string): AudioFormat | null {
  return EXTENSION_FORMATS[audioExtension(filename)] ?? null
}

/**
 * Sniff the container.
 *
 * Magic bytes win over the extension: files are frequently misnamed, and the
 * container is what actually decides how to read the tags.
 */
export function detectAudioFormat(filename: string, buffer: Buffer): AudioFormat | null {
  if (isFlacSignature(buffer)) return 'flac'
  if (isOgg(buffer)) return 'ogg'
  if (isMp4(buffer)) return 'm4a'
  if (isMp3(buffer)) return 'mp3'
  return formatFromExtension(filename)
}

function isFlacSignature(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'fLaC'
}

export interface AudioMetadata extends TaggedFields {
  format: AudioFormat
  picture: AudioPicture | null
  /** Seconds; 0 when the container did not say. */
  duration: number
  bitrate?: number
  sampleRate?: number
  channels?: number
}

const EMPTY_FIELDS: TaggedFields = { compilation: false }

/** Strip the extension and split a `Artist - Title` filename. */
export function parseAudioFilename(filename: string): { title: string, artist?: string } {
  const base = String(filename ?? '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim()
  if (!base) return { title: 'Unknown track' }

  // Drop a leading track number first, so `05 - Artist - Title` splits on the
  // right dash instead of treating the number as the artist.
  const trimmed = base.replace(/^\d{1,3}\s*[-.)]\s+/, '')

  const separator = trimmed.match(/\s+[-–—]\s+/)
  if (separator && separator.index !== undefined && separator.index > 0) {
    const artist = trimmed.slice(0, separator.index).trim()
    const title = trimmed.slice(separator.index + separator[0].length).trim()
    if (artist && title) return { title, artist }
  }

  return { title: trimmed || base }
}

/**
 * Read the tags, runtime and artwork of an audio buffer.
 *
 * Never throws: a file we cannot parse still gets a format (from its extension)
 * and falls back to the filename for its title, so a broken tag block can never
 * block an upload.
 */
export function extractAudioMetadata(buffer: Buffer, filename: string): AudioMetadata {
  const format = detectAudioFormat(filename, buffer) ?? formatFromExtension(filename) ?? 'mp3'
  const fallback = parseAudioFilename(filename)

  let fields: TaggedFields = EMPTY_FIELDS
  let picture: AudioPicture | null = null
  let duration = 0
  let bitrate: number | undefined
  let sampleRate: number | undefined
  let channels: number | undefined

  try {
    if (format === 'flac') {
      const info = parseFlac(buffer)
      if (info) {
        fields = info.fields
        picture = info.picture
        duration = info.duration
        sampleRate = info.sampleRate
        channels = info.channels
      }
    } else if (format === 'ogg') {
      const info = parseOgg(buffer)
      if (info) {
        fields = info.fields
        picture = info.picture
        duration = info.duration
        sampleRate = info.sampleRate
        channels = info.channels
      }
    } else if (format === 'm4a') {
      const info = parseMp4(buffer)
      if (info) {
        fields = info.fields
        picture = info.picture
        duration = info.duration
        sampleRate = info.sampleRate
        channels = info.channels
      }
    } else {
      const info = parseMp3(buffer)
      fields = info.fields
      picture = info.picture
      duration = info.duration
      bitrate = info.bitrate
      sampleRate = info.sampleRate
      channels = info.channels
    }
  } catch {
    // A malformed tag block must not fail the upload.
    fields = EMPTY_FIELDS
    picture = null
  }

  // Players display the average bitrate; the container only ever reports it for
  // MP3 (where a constant bitrate is the norm).
  if (!bitrate && duration > 0) {
    bitrate = Math.round((buffer.length * 8) / duration / 1000)
  }

  return {
    ...fields,
    title: fields.title || fallback.title,
    artist: fields.artist || fallback.artist,
    format,
    picture,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    bitrate,
    sampleRate,
    channels
  }
}
