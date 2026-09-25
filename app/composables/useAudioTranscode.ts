/**
 * Music module — browser-side audio conversion with ffmpeg.wasm.
 *
 * ffmpeg.wasm is fetched from a CDN the moment a user asks for a conversion and
 * never bundled, which keeps the module's zero-dependency promise: a visitor who
 * never converts anything downloads nothing, and the server needs no ffmpeg
 * binary and stores no converted copies.
 *
 * Everything runs in a Web Worker inside the page, so the trade-offs are real
 * and are surfaced rather than hidden:
 *   - the whole file is held in memory (wasm has a hard ceiling well below a
 *     native build's), so very large lossless files may fail;
 *   - the CDN must be reachable — self-host it by setting
 *     `runtimeConfig.public.musicFfmpegBase` to a copy of the three files;
 *   - a strict `Content-Security-Policy` can block the worker and the wasm.
 */
import {
  transcodeArgs,
  transcodeFilename,
  type TranscodeTarget
} from '../utils/transcode'

export type TranscodeState = 'idle' | 'loading' | 'ready' | 'running' | 'error'

export interface TranscodeResult {
  blob: Blob
  /** Object URL — hand it to an `<audio>` element or a download link. */
  url: string
  filename: string
  mimeType: string
  size: number
}

interface FfmpegInstance {
  load: (options: { coreURL: string, wasmURL: string }) => Promise<void>
  writeFile: (path: string, data: Uint8Array) => Promise<boolean>
  readFile: (path: string) => Promise<Uint8Array | string>
  deleteFile: (path: string) => Promise<boolean>
  exec: (args: string[]) => Promise<number>
  on: (event: 'progress', handler: (payload: { progress: number }) => void) => void
  off: (event: 'progress', handler: (payload: { progress: number }) => void) => void
  terminate: () => void
}

interface FfmpegGlobals {
  FFmpegWASM?: { FFmpeg: new () => FfmpegInstance }
  FFmpegUtil?: {
    fetchFile: (input: Blob | string) => Promise<Uint8Array>
    toBlobURL: (url: string, mimeType: string) => Promise<string>
  }
}

/** Pinned versions: the wasm core and the wrapper must stay in step. */
const FFMPEG_VERSION = '0.12.10'
const UTIL_VERSION = '0.12.1'
const CORE_VERSION = '0.12.6'

/** Cached across the whole page: the wasm download is the expensive part. */
let loadPromise: Promise<FfmpegInstance> | null = null
const scriptPromises = new Map<string, Promise<void>>()

function globals(): FfmpegGlobals {
  return window as unknown as FfmpegGlobals
}

function loadScript(url: string): Promise<void> {
  const existing = scriptPromises.get(url)
  if (existing) return existing

  const promise = new Promise<void>((resolve, reject) => {
    const element = document.createElement('script')
    element.src = url
    element.async = true
    element.crossOrigin = 'anonymous'
    element.onload = () => resolve()
    element.onerror = () => reject(new Error(`Failed to load ${url}`))
    document.head.appendChild(element)
  })
  scriptPromises.set(url, promise)
  return promise
}

async function ensureFfmpeg(): Promise<FfmpegInstance> {
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const config = useRuntimeConfig()
    const base = String(config.public.musicFfmpegBase || 'https://unpkg.com').replace(/\/$/, '')

    await loadScript(`${base}/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/umd/ffmpeg.js`)
    await loadScript(`${base}/@ffmpeg/util@${UTIL_VERSION}/dist/umd/index.js`)

    const api = globals()
    if (!api.FFmpegWASM || !api.FFmpegUtil) {
      throw new Error('ffmpeg.wasm loaded but did not register its globals')
    }

    // `toBlobURL` re-serves the core and the wasm from same-origin blob URLs,
    // which is what lets them be fetched inside the worker.
    const coreURL = await api.FFmpegUtil.toBlobURL(
      `${base}/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`,
      'text/javascript'
    )
    const wasmURL = await api.FFmpegUtil.toBlobURL(
      `${base}/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`,
      'application/wasm'
    )

    const instance = new api.FFmpegWASM.FFmpeg()
    await instance.load({ coreURL, wasmURL })
    return instance
  })().catch((error) => {
    // Allow a later retry after a transient network failure.
    loadPromise = null
    throw error
  })

  return loadPromise
}

/** Extension hint for the input file, so ffmpeg does not have to guess. */
function inputExtension(sourceName: string | undefined): string {
  const match = String(sourceName ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return match ? match[1]! : 'bin'
}

export function useAudioTranscode() {
  const state = ref<TranscodeState>('idle')
  const progress = ref(0)
  const error = ref<string | null>(null)

  const busy = computed(() => state.value === 'loading' || state.value === 'running')

  /** Download a track's bytes for conversion (or for any other local use). */
  async function fetchAudio(url: string): Promise<Blob> {
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.blob()
  }

  /**
   * Convert `source` and hand back a downloadable/playable blob URL.
   *
   * The caller owns the returned URL and should `URL.revokeObjectURL` it when
   * the dialog closes.
   */
  async function convert(
    source: Blob,
    target: TranscodeTarget,
    options: { sourceName?: string } = {}
  ): Promise<TranscodeResult> {
    if (!import.meta.client) throw new Error('Conversion runs in the browser only')
    error.value = null
    progress.value = 0

    const inputName = `input.${inputExtension(options.sourceName)}`
    const outputName = `output.${target.extension}`

    let ffmpeg: FfmpegInstance | null = null
    try {
      state.value = loadPromise ? 'ready' : 'loading'
      ffmpeg = await ensureFfmpeg()
      state.value = 'running'

      const api = globals()
      await ffmpeg.writeFile(inputName, await api.FFmpegUtil!.fetchFile(source))

      const onProgress = (payload: { progress: number }) => {
        // ffmpeg reports NaN for the first few frames; clamp whatever arrives.
        if (Number.isFinite(payload.progress)) progress.value = Math.min(1, Math.max(0, payload.progress))
      }
      ffmpeg.on('progress', onProgress)

      try {
        await ffmpeg.exec(transcodeArgs(inputName, target, outputName))
      } finally {
        ffmpeg.off('progress', onProgress)
      }

      const data = await ffmpeg.readFile(outputName)
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
      // Slice by the view's own bounds: wasm memory is reused between calls.
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const blob = new Blob([buffer], { type: target.mimeType })

      progress.value = 1
      state.value = 'ready'
      return {
        blob,
        url: URL.createObjectURL(blob),
        filename: transcodeFilename(options.sourceName, target),
        mimeType: target.mimeType,
        size: blob.size
      }
    } catch (cause) {
      state.value = 'error'
      error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      // Free the wasm filesystem either way — the memory is the scarce resource.
      if (ffmpeg) {
        await ffmpeg.deleteFile(inputName).catch(() => {})
        await ffmpeg.deleteFile(outputName).catch(() => {})
      }
    }
  }

  function reset() {
    state.value = loadPromise ? 'ready' : 'idle'
    progress.value = 0
    error.value = null
  }

  return { state, progress, error, busy, fetchAudio, convert, reset }
}
