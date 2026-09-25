/**
 * Music module — the global player.
 *
 * One `Audio` element and one queue live at module scope, so playback survives
 * navigation: the layout that renders the player bar may unmount and remount
 * without interrupting the music.
 *
 * Everything here mutates only on the client. The module-scope refs are shared
 * across renders by design (that *is* the singleton), so nothing on the server
 * ever writes to them — an SSR render shows an empty queue and nothing leaks
 * between requests.
 */
import type { MusicTrack } from './useMusic'

export type RepeatMode = 'off' | 'all' | 'one'

const SETTINGS_KEY = 'music:player'

const queue = ref<MusicTrack[]>([])
const index = ref(0)
const playing = ref(false)
const loading = ref(false)
const failed = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const volume = ref(1)
const muted = ref(false)
const shuffle = ref(false)
const repeat = ref<RepeatMode>('off')

let audio: HTMLAudioElement | null = null
/** The track whose play has not been reported to the server yet. */
let unreportedTrackId: number | null = null

const current = computed<MusicTrack | null>(() => queue.value[index.value] ?? null)

function readSettings(): void {
  if (!import.meta.client) return
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { volume?: number, muted?: boolean, shuffle?: boolean, repeat?: RepeatMode }
    if (typeof parsed.volume === 'number') volume.value = Math.min(1, Math.max(0, parsed.volume))
    if (typeof parsed.muted === 'boolean') muted.value = parsed.muted
    if (typeof parsed.shuffle === 'boolean') shuffle.value = parsed.shuffle
    if (parsed.repeat === 'off' || parsed.repeat === 'all' || parsed.repeat === 'one') repeat.value = parsed.repeat
  } catch {
    /* a corrupt settings blob is not worth surfacing */
  }
}

function writeSettings(): void {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      volume: volume.value,
      muted: muted.value,
      shuffle: shuffle.value,
      repeat: repeat.value
    }))
  } catch {
    /* private mode / quota — the settings simply do not persist */
  }
}

/**
 * Tell the server how much was actually heard.
 *
 * Drives "recently played" and the play counter; fired when a track is replaced
 * or ends, and silently dropped on failure so tracking can never break playback.
 */
function reportPlay(): void {
  const trackId = unreportedTrackId
  unreportedTrackId = null
  if (trackId == null || !audio) return
  const msPlayed = Math.round((audio.currentTime || 0) * 1000)
  if (msPlayed < 1000) return
  void cPost(`/api/music/tracks/${trackId}/play`, { msPlayed }).catch(() => {})
}

interface MediaSessionLike {
  metadata: unknown
  setActionHandler: (action: string, handler: (() => void) | null) => void
}

/** Wire up OS-level transport controls (lock screen, media keys). */
function applyMediaSession(track: MusicTrack): void {
  if (!import.meta.client) return
  const session = (navigator as unknown as { mediaSession?: MediaSessionLike }).mediaSession
  if (!session) return
  try {
    const Metadata = (window as unknown as { MediaMetadata?: new (init: Record<string, unknown>) => unknown }).MediaMetadata
    if (Metadata) {
      session.metadata = new Metadata({
        title: track.title,
        artist: track.artistName ?? '',
        album: track.albumName ?? '',
        artwork: track.coverUrl ? [{ src: track.coverUrl }] : []
      })
    }
    session.setActionHandler('play', () => void play())
    session.setActionHandler('pause', () => pause())
    session.setActionHandler('nexttrack', () => next())
    session.setActionHandler('previoustrack', () => previous())
  } catch {
    /* an unsupported action must not break playback */
  }
}

function ensureAudio(): HTMLAudioElement | null {
  if (!import.meta.client) return null
  if (audio) return audio

  const element = new Audio()
  element.preload = 'metadata'
  // Kept in the document (hidden) rather than fully detached: it makes the
  // element inspectable, gives the browser a stable lifecycle to attach its own
  // media handling to, and lets devtools show exactly what is being decoded.
  element.hidden = true
  document.body.appendChild(element)
  readSettings()
  element.volume = volume.value
  element.muted = muted.value

  element.addEventListener('timeupdate', () => {
    currentTime.value = element.currentTime
  })
  element.addEventListener('durationchange', () => {
    if (Number.isFinite(element.duration) && element.duration > 0) duration.value = element.duration
  })
  element.addEventListener('playing', () => {
    playing.value = true
    loading.value = false
    failed.value = false
  })
  element.addEventListener('pause', () => {
    playing.value = false
  })
  element.addEventListener('waiting', () => {
    loading.value = true
  })
  element.addEventListener('ended', () => {
    reportPlay()
    advance(true)
  })
  element.addEventListener('error', () => {
    // Most often a missing file (the catalogue row outlived its bytes) or a codec
    // the browser refuses; the UI offers conversion in that case.
    failed.value = true
    playing.value = false
    loading.value = false
  })

  audio = element
  return audio
}

async function play(): Promise<void> {
  const element = ensureAudio()
  if (!element || !current.value) return
  loading.value = true
  try {
    await element.play()
    playing.value = true
  } catch {
    // Autoplay rejection: remain paused, the user's next click will start it.
    playing.value = false
  } finally {
    loading.value = false
  }
}

function pause(): void {
  audio?.pause()
  playing.value = false
}

function toggle(): void {
  if (playing.value) pause()
  else void play()
}

/** Load a track; when it is not in the queue it is appended. */
function load(track: MusicTrack, autoplay = true): void {
  const element = ensureAudio()
  if (!element) return

  reportPlay()

  let position = queue.value.findIndex(item => item.id === track.id)
  if (position < 0) {
    queue.value = [...queue.value, track]
    position = queue.value.length - 1
  }
  index.value = position

  element.src = track.streamUrl
  currentTime.value = 0
  duration.value = track.duration || 0
  failed.value = false
  unreportedTrackId = track.id
  applyMediaSession(track)

  if (autoplay) void play()
}

/** Replace the queue and start at `startIndex`. */
function playQueue(tracks: MusicTrack[], startIndex = 0): void {
  if (!tracks.length) return
  queue.value = [...tracks]
  const track = queue.value[Math.min(Math.max(0, startIndex), queue.value.length - 1)]
  if (track) load(track)
}

/** Next position, honouring shuffle and repeat. `null` means "stop". */
function pickNext(auto: boolean): number | null {
  const size = queue.value.length
  if (!size) return null
  if (shuffle.value && size > 1) {
    let candidate = index.value
    // A single random draw can land on the same track; retry a few times.
    for (let attempt = 0; attempt < 8 && candidate === index.value; attempt++) {
      candidate = Math.floor(Math.random() * size)
    }
    return candidate
  }
  const upcoming = index.value + 1
  if (upcoming < size) return upcoming
  if (repeat.value === 'all' || !auto) return 0
  return null
}

function advance(auto: boolean): void {
  const nextIndex = pickNext(auto)
  if (nextIndex == null) {
    playing.value = false
    return
  }
  const track = queue.value[nextIndex]
  if (track) load(track)
}

function next(): void {
  if (repeat.value === 'one' && index.value >= 0 && playing.value) {
    seek(0)
    void play()
    return
  }
  advance(false)
}

function previous(): void {
  const element = ensureAudio()
  // Restart the track first: that is what a listener expects from "previous".
  if (element && element.currentTime > 3) {
    seek(0)
    return
  }
  const size = queue.value.length
  if (!size) return
  const target = index.value - 1 < 0 ? size - 1 : index.value - 1
  const track = queue.value[target]
  if (track) load(track)
}

function seek(seconds: number): void {
  const element = ensureAudio()
  if (!element) return
  try {
    element.currentTime = Math.max(0, seconds)
    currentTime.value = element.currentTime
  } catch {
    /* seeking before metadata is ready throws in some browsers */
  }
}

function setVolume(value: number): void {
  const clamped = Math.min(1, Math.max(0, value))
  volume.value = clamped
  if (clamped > 0 && muted.value) muted.value = false
  const element = ensureAudio()
  if (element) {
    element.volume = clamped
    element.muted = muted.value
  }
  writeSettings()
}

function toggleMute(): void {
  muted.value = !muted.value
  const element = ensureAudio()
  if (element) element.muted = muted.value
  writeSettings()
}

function toggleShuffle(): void {
  shuffle.value = !shuffle.value
  writeSettings()
}

function cycleRepeat(): void {
  repeat.value = repeat.value === 'off' ? 'all' : repeat.value === 'all' ? 'one' : 'off'
  writeSettings()
}

/** Append to the queue without interrupting playback. */
function enqueue(track: MusicTrack): void {
  if (queue.value.some(item => item.id === track.id)) {
    // Already queued: jump to it instead of adding a duplicate.
    load(track)
    return
  }
  queue.value = [...queue.value, track]
  if (!current.value) load(track)
}

/** Insert right after the current track. */
function playNext(track: MusicTrack): void {
  const rest = queue.value.filter(item => item.id !== track.id)
  const insertAt = queue.value.length ? index.value + 1 : 0
  queue.value = [...rest.slice(0, insertAt), track, ...rest.slice(insertAt)]
}

function removeFromQueue(position: number): void {
  if (position < 0 || position >= queue.value.length) return
  const wasCurrent = position === index.value
  queue.value = queue.value.filter((_item, i) => i !== position)
  if (!queue.value.length) {
    clearQueue()
    return
  }
  if (position < index.value) index.value -= 1
  if (wasCurrent) {
    const track = queue.value[Math.min(index.value, queue.value.length - 1)]
    if (track) load(track, playing.value)
  }
}

function clearQueue(): void {
  reportPlay()
  audio?.pause()
  if (audio) audio.removeAttribute('src')
  queue.value = []
  index.value = 0
  playing.value = false
  currentTime.value = 0
  duration.value = 0
  failed.value = false
  unreportedTrackId = null
}

function jumpTo(position: number): void {
  const track = queue.value[position]
  if (track) load(track)
}

export function useMusicPlayer() {
  return {
    queue: readonly(queue),
    index: readonly(index),
    current,
    playing: readonly(playing),
    loading: readonly(loading),
    failed: readonly(failed),
    currentTime: readonly(currentTime),
    duration: readonly(duration),
    volume: readonly(volume),
    muted: readonly(muted),
    shuffle: readonly(shuffle),
    repeat: readonly(repeat),
    load,
    playQueue,
    play,
    pause,
    toggle,
    next,
    previous,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    enqueue,
    playNext,
    removeFromQueue,
    clearQueue,
    jumpTo
  }
}
