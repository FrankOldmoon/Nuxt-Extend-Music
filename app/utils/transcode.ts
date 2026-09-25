/**
 * Music module — audio conversion vocabulary.
 *
 * Conversion happens in the browser through ffmpeg.wasm (see
 * `app/composables/useAudioTranscode.ts`), so the target list, the ffmpeg
 * argument building and the browser capability probe all live client-side. They
 * are pure functions, so the mapping is unit-tested without loading any wasm.
 */

export type TranscodeFormat = 'mp3' | 'm4a' | 'opus' | 'wav'

export interface TranscodeTarget {
  /** Stable key used in the UI and URLs: `mp3:192`, `wav`. */
  key: string
  format: TranscodeFormat
  /** null for lossless targets (wav), which are not bitrate-driven. */
  bitrate: number | null
  /** i18n key under `music.transcode.format.*`. */
  labelKey: string
  extension: string
  mimeType: string
  /** The ffmpeg arguments that select this container/codec. */
  codecArgs: string[]
}

type TargetSpec = Omit<TranscodeTarget, 'key'>

const SPECS: TargetSpec[] = [
  {
    format: 'mp3',
    bitrate: 320,
    labelKey: 'music.transcode.format.mp3_320',
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    codecArgs: ['-codec:a', 'libmp3lame', '-f', 'mp3']
  },
  {
    format: 'mp3',
    bitrate: 192,
    labelKey: 'music.transcode.format.mp3_192',
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    codecArgs: ['-codec:a', 'libmp3lame', '-f', 'mp3']
  },
  {
    format: 'mp3',
    bitrate: 128,
    labelKey: 'music.transcode.format.mp3_128',
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    codecArgs: ['-codec:a', 'libmp3lame', '-f', 'mp3']
  },
  {
    format: 'm4a',
    bitrate: 192,
    labelKey: 'music.transcode.format.m4a_192',
    extension: 'm4a',
    mimeType: 'audio/mp4',
    codecArgs: ['-codec:a', 'aac', '-f', 'mp4']
  },
  {
    format: 'opus',
    bitrate: 128,
    labelKey: 'music.transcode.format.opus_128',
    extension: 'opus',
    mimeType: 'audio/ogg',
    codecArgs: ['-codec:a', 'libopus', '-f', 'ogg']
  },
  {
    format: 'wav',
    bitrate: null,
    labelKey: 'music.transcode.format.wav',
    extension: 'wav',
    mimeType: 'audio/wav',
    codecArgs: ['-codec:a', 'pcm_s16le', '-f', 'wav']
  }
]

/** Every conversion the UI offers, most compatible first. */
export const TRANSCODE_TARGETS: TranscodeTarget[] = SPECS.map(spec => ({
  ...spec,
  key: spec.bitrate ? `${spec.format}:${spec.bitrate}` : spec.format
}))

export const DEFAULT_TRANSCODE_TARGET = 'mp3:192'

/** Resolve a key like `mp3:192` or `wav`; null for anything unknown. */
export function parseTranscodeTarget(key: string | null | undefined): TranscodeTarget | null {
  const normalized = String(key ?? '').trim().toLowerCase()
  if (!normalized) return null
  return TRANSCODE_TARGETS.find(target => target.key === normalized) ?? null
}

/** `song.flac` + `mp3:192` → `song.mp3`. */
export function transcodeFilename(originalName: string | null | undefined, target: TranscodeTarget): string {
  const base = String(originalName ?? 'track').replace(/\.[a-z0-9]+$/i, '').trim() || 'track'
  return `${base}.${target.extension}`
}

/**
 * The ffmpeg argument list for one conversion.
 *
 * `-vn` drops any embedded cover art: muxing a JPEG into an audio-only container
 * fails for several of these targets, and the artwork is already in the catalogue.
 */
export function transcodeArgs(inputName: string, target: TranscodeTarget, outputName: string): string[] {
  const args = ['-i', inputName, '-vn']
  if (target.bitrate) args.push('-b:a', `${target.bitrate}k`)
  args.push(...target.codecArgs, outputName)
  return args
}

/**
 * Whether this browser can play a container, probed rather than assumed.
 *
 * Used to decide when to *offer* conversion: an unplayable codec is the one
 * situation where converting is worth the wait.
 */
export function canPlayMime(mimeType: string | null | undefined): boolean {
  if (!mimeType) return true
  if (typeof document === 'undefined') return true
  const probe = document.createElement('audio')
  const verdict = probe.canPlayType(mimeType)
  return verdict === 'probably' || verdict === 'maybe'
}
