/**
 * Music module — conversion vocabulary tests.
 *
 * The conversion itself runs in the browser through ffmpeg.wasm, which cannot be
 * exercised in a unit test; what *can* be pinned is everything around it: the
 * target table, the argument list handed to ffmpeg, the output filename and the
 * capability probe's safe fallback.
 */
import { describe, it, expect } from 'vitest'
import {
  canPlayMime,
  DEFAULT_TRANSCODE_TARGET,
  parseTranscodeTarget,
  transcodeArgs,
  transcodeFilename,
  TRANSCODE_TARGETS
} from '../../app/utils/transcode'

describe('transcode targets', () => {
  it('builds a unique key from format and bitrate', () => {
    const keys = TRANSCODE_TARGETS.map(target => target.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const target of TRANSCODE_TARGETS) {
      expect(target.key).toBe(target.bitrate ? `${target.format}:${target.bitrate}` : target.format)
    }
  })

  it('offers an mp3 option and a lossless option', () => {
    expect(TRANSCODE_TARGETS.some(target => target.format === 'mp3')).toBe(true)
    // Lossless targets carry no bitrate, which is what `transcodeArgs` keys off.
    const lossless = TRANSCODE_TARGETS.filter(target => target.bitrate === null)
    expect(lossless.length).toBeGreaterThan(0)
    expect(lossless.every(target => target.format === 'wav')).toBe(true)
  })

  it('resolves the default target', () => {
    expect(parseTranscodeTarget(DEFAULT_TRANSCODE_TARGET)?.format).toBe('mp3')
    expect(parseTranscodeTarget('MP3:192')?.bitrate).toBe(192)
    expect(parseTranscodeTarget('wav')?.extension).toBe('wav')
    expect(parseTranscodeTarget('flac:999')).toBeNull()
    expect(parseTranscodeTarget('')).toBeNull()
    expect(parseTranscodeTarget(null)).toBeNull()
  })

  it('gives every target a distinct extension and a MIME type', () => {
    for (const target of TRANSCODE_TARGETS) {
      expect(target.extension.length).toBeGreaterThan(0)
      expect(target.mimeType).toMatch(/^audio\//)
      expect(target.codecArgs.length).toBeGreaterThan(0)
      expect(target.labelKey.startsWith('music.transcode.format.')).toBe(true)
    }
  })
})

describe('transcodeArgs', () => {
  it('drops video/artwork and selects the codec', () => {
    const mp3 = parseTranscodeTarget('mp3:192')!
    expect(transcodeArgs('in.flac', mp3, 'out.mp3')).toEqual([
      '-i', 'in.flac', '-vn', '-b:a', '192k', '-codec:a', 'libmp3lame', '-f', 'mp3', 'out.mp3'
    ])
  })

  it('omits the bitrate for lossless targets', () => {
    const wav = parseTranscodeTarget('wav')!
    const args = transcodeArgs('in.flac', wav, 'out.wav')
    expect(args).not.toContain('-b:a')
    expect(args).toContain('pcm_s16le')
  })
})

describe('transcodeFilename', () => {
  it('swaps the extension', () => {
    const mp3 = parseTranscodeTarget('mp3:320')!
    expect(transcodeFilename('05 - Radiohead - Creep.flac', mp3)).toBe('05 - Radiohead - Creep.mp3')
  })

  it('falls back when there is no usable name', () => {
    const wav = parseTranscodeTarget('wav')!
    expect(transcodeFilename('', wav)).toBe('track.wav')
    expect(transcodeFilename(undefined, wav)).toBe('track.wav')
  })
})

describe('canPlayMime', () => {
  it('assumes playable where there is no DOM to probe', () => {
    // Server-side rendering must not report "cannot play" for every track.
    expect(canPlayMime('audio/flac')).toBe(true)
    expect(canPlayMime(null)).toBe(true)
    expect(canPlayMime('')).toBe(true)
  })
})
