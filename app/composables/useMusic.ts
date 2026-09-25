/**
 * Music module — client types and shared display helpers.
 *
 * These mirror the DTOs the API returns (`server/utils/catalogue.ts`); keeping
 * one copy here means components can be typed without importing server code.
 */

export interface MusicTrack {
  id: number
  title: string
  duration: number
  format: string
  mimeType: string | null
  size: number
  bitrate: number | null
  sampleRate: number | null
  channels: number | null
  trackNo: number | null
  discNo: number | null
  year: number | null
  isPublic: boolean
  playCount: number
  lastPlayedAt: string | null
  createdAt: string
  hasLyrics: boolean
  artistId: number | null
  artistName: string | null
  albumArtistId: number | null
  albumArtistName: string | null
  albumId: number | null
  albumName: string | null
  genreId: number | null
  genreName: string | null
  coverUrl: string | null
  streamUrl: string
  starred: boolean
  canEdit: boolean
}

export interface MusicAlbum {
  id: number
  name: string
  year: number | null
  trackCount: number
  duration: number
  playCount: number
  isCompilation: boolean
  artistId: number | null
  artistName: string | null
  coverUrl: string | null
  createdAt: string
  starred: boolean
}

export interface MusicArtist {
  id: number
  name: string
  trackCount: number
  albumCount: number
  playCount: number
  coverUrl: string | null
  starred: boolean
}

export interface MusicGenre {
  id: number
  name: string
  slug: string
  trackCount: number
}

export interface MusicPlaylist {
  id: number
  name: string
  description: string | null
  coverUrl: string | null
  isPublic: boolean
  trackCount: number
  duration: number
  updatedAt: string
  canEdit: boolean
  mine: boolean
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface MusicStats {
  tracks: number
  albums: number
  artists: number
  genres: number
  duration: number
}

export interface MusicHome {
  viewer: { signedIn: boolean, admin: boolean }
  stats: MusicStats
  recentlyAdded: MusicTrack[]
  mostPlayed: MusicTrack[]
  recentlyPlayed: MusicTrack[]
  recentAlbums: MusicAlbum[]
  randomAlbums: MusicAlbum[]
  playlists: Array<Pick<MusicPlaylist, 'id' | 'name' | 'coverUrl' | 'trackCount' | 'isPublic'>>
}

/** `245.3` → `4:05`; `3725` → `1:02:05`. `--:--` when unknown. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '--:--'
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}

/** Total runtime in words, for the stat line: `3 小时 12 分` / `12 分`. */
export function formatRuntime(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '0'
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : `${minutes}`
}

/** The line under a track title: artist, then album. */
export function trackSubtitle(track: Pick<MusicTrack, 'artistName' | 'albumName'>): string {
  return [track.artistName, track.albumName].filter(Boolean).join(' · ')
}

/** Sort helper shared by the album/artist grids. */
export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name)
}

/** Fetch helpers — thin wrappers so call sites stay short and typed. */
export function fetchTracks(query: Record<string, unknown> = {}): Promise<Paginated<MusicTrack>> {
  return cGet<Paginated<MusicTrack>>('/api/music/tracks', query)
}

export function fetchAlbums(query: Record<string, unknown> = {}): Promise<Paginated<MusicAlbum>> {
  return cGet<Paginated<MusicAlbum>>('/api/music/albums', query)
}

export function fetchArtists(query: Record<string, unknown> = {}): Promise<Paginated<MusicArtist>> {
  return cGet<Paginated<MusicArtist>>('/api/music/artists', query)
}
