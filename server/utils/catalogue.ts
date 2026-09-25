/**
 * Music module — catalogue domain logic.
 *
 * Everything that shapes the catalogue lives here: the anonymous-visible
 * viewer model, entity resolution (the same artist/album spelled slightly
 * differently must not fork), counter maintenance, and the track projection the
 * API returns (joined names, cover URL, starred flag).
 *
 * Visibility rule: a track is public, or it belongs to the viewer. Anonymous
 * visitors therefore see the home page and every public track — there is no
 * login wall — while uploads and edits require a session.
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { H3Event } from 'h3'
import { db } from '../../../../server/database'
import { getSessionUser } from '../../../../server/utils/auth'
import * as mus from '../database/schema'

/** Who is looking. `userId: null` means an anonymous visitor. */
export interface Viewer {
  userId: number | null
  admin: boolean
}

export async function getViewer(event: H3Event): Promise<Viewer> {
  const ctx = await getSessionUser(event)
  if (!ctx) return { userId: null, admin: false }
  return { userId: ctx.user.id, admin: ctx.role?.name === 'admin' }
}

// --------------------------------------------------------------- naming ----

const LEADING_ARTICLES = new Set([
  'a', 'an', 'the',
  'el', 'la', 'los', 'las', 'le', 'les', 'un', 'une',
  'der', 'die', 'das', 'ein', 'eine'
])

/** "The Beatles" → "beatles, the"; used as the sort key (lower-cased). */
export function sortNameFor(name: string): string {
  const trimmed = String(name ?? '').trim()
  const match = /^(\S+)\s+(.+)$/.exec(trimmed)
  if (match && LEADING_ARTICLES.has(match[1]!.toLowerCase())) {
    return `${match[2]}, ${match[1]}`.toLowerCase()
  }
  return trimmed.toLowerCase()
}

export function slugify(value: string): string {
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'unknown'
}

/** Cover paths are stored storage-relative; the host serves them by URL. */
export function coverUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path
  return `/api/files/serve/${path}`
}

// ----------------------------------------------------------- visibility ----

/** Condition matching every track the viewer may see and play. */
export function trackVisibility(viewer: Viewer) {
  const live = and(isNull(mus.musTracks.deletedAt), eq(mus.musTracks.isActive, true))
  if (viewer.admin) return live
  if (viewer.userId == null) return and(live, eq(mus.musTracks.isPublic, true))
  return and(live, or(eq(mus.musTracks.isPublic, true), eq(mus.musTracks.userId, viewer.userId)))
}

/** Whether the viewer may change this track. */
export function canEditTrack(viewer: Viewer, track: { userId: number | null }): boolean {
  if (viewer.admin) return true
  return viewer.userId != null && track.userId === viewer.userId
}

/**
 * The same rule as `trackVisibility`, as a raw fragment for a *different* table
 * alias — needed by the correlated `exists` clauses below, which ask "does this
 * album/artist/genre have at least one track the viewer may see?".
 */
function visibleTrackSql(alias: string, viewer: Viewer) {
  const base = sql`${sql.raw(alias)}.deleted_at is null and ${sql.raw(alias)}.is_active = true`
  if (viewer.admin) return base
  if (viewer.userId == null) return sql`${base} and ${sql.raw(alias)}.is_public = true`
  return sql`${base} and (${sql.raw(alias)}.is_public = true or ${sql.raw(alias)}.user_id = ${viewer.userId})`
}

/**
 * Entities are only listed when at least one of their tracks is visible, so an
 * anonymous visitor never sees an artist page whose every track is private.
 */
export function visibleAlbumCondition(viewer: Viewer) {
  return and(
    isNull(mus.musAlbums.deletedAt),
    sql`exists (select 1 from mus_tracks t where t.album_id = ${mus.musAlbums.id} and ${visibleTrackSql('t', viewer)})`
  )
}

export function visibleArtistCondition(viewer: Viewer) {
  return and(
    isNull(mus.musArtists.deletedAt),
    sql`exists (select 1 from mus_tracks t where (t.artist_id = ${mus.musArtists.id} or t.album_artist_id = ${mus.musArtists.id}) and ${visibleTrackSql('t', viewer)})`
  )
}

export function visibleGenreCondition(viewer: Viewer) {
  return and(
    isNull(mus.musGenres.deletedAt),
    sql`exists (select 1 from mus_tracks t where t.genre_id = ${mus.musGenres.id} and ${visibleTrackSql('t', viewer)})`
  )
}

/** Whether the viewer may see one entity — checked before starring it. */
export async function entityVisible(viewer: Viewer, type: 'track' | 'album' | 'artist', id: number): Promise<boolean> {
  if (type === 'track') {
    const [row] = await db.select({ id: mus.musTracks.id }).from(mus.musTracks)
      .where(and(eq(mus.musTracks.id, id), trackVisibility(viewer))).limit(1)
    return !!row
  }
  if (type === 'album') {
    const [row] = await db.select({ id: mus.musAlbums.id }).from(mus.musAlbums)
      .where(and(eq(mus.musAlbums.id, id), visibleAlbumCondition(viewer))).limit(1)
    return !!row
  }
  const [row] = await db.select({ id: mus.musArtists.id }).from(mus.musArtists)
    .where(and(eq(mus.musArtists.id, id), visibleArtistCondition(viewer))).limit(1)
  return !!row
}

// ----------------------------------------------------------- resolution ----

/**
 * Find or create an artist by name.
 *
 * The lookup is case-insensitive on purpose: taggers disagree about casing far
 * more often than they disagree about spelling, and two "radiohead" rows would
 * split the artist page in half.
 */
export async function ensureArtist(name: string | undefined | null): Promise<number | null> {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return null

  const existing = await db
    .select({ id: mus.musArtists.id })
    .from(mus.musArtists)
    .where(eq(mus.musArtists.name, trimmed))
    .limit(1)
  if (existing[0]) return existing[0].id

  const inserted = await db
    .insert(mus.musArtists)
    .values({ name: trimmed, sortName: sortNameFor(trimmed) })
    .returning({ id: mus.musArtists.id })
  return inserted[0]?.id ?? null
}

export async function ensureGenre(name: string | undefined | null): Promise<number | null> {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return null

  const slug = slugify(trimmed)
  const existing = await db
    .select({ id: mus.musGenres.id })
    .from(mus.musGenres)
    .where(eq(mus.musGenres.slug, slug))
    .limit(1)
  if (existing[0]) return existing[0].id

  try {
    const inserted = await db
      .insert(mus.musGenres)
      .values({ name: trimmed, slug })
      .returning({ id: mus.musGenres.id })
    return inserted[0]?.id ?? null
  } catch {
    const raced = await db
      .select({ id: mus.musGenres.id })
      .from(mus.musGenres)
      .where(eq(mus.musGenres.slug, slug))
      .limit(1)
    return raced[0]?.id ?? null
  }
}

/**
 * Find or create an album, keyed by (name, album artist).
 *
 * Keying on the album artist rather than the track artist is what keeps
 * compilations in one album instead of one album per contributing artist.
 */
export async function ensureAlbum(
  name: string | undefined | null,
  artistId: number | null,
  year?: number | null,
  isCompilation = false
): Promise<number | null> {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return null

  const existing = await db
    .select({ id: mus.musAlbums.id, year: mus.musAlbums.year, cover: mus.musAlbums.cover })
    .from(mus.musAlbums)
    .where(and(
      eq(mus.musAlbums.name, trimmed),
      artistId == null ? isNull(mus.musAlbums.artistId) : eq(mus.musAlbums.artistId, artistId)
    ))
    .limit(1)
  if (existing[0]) return existing[0].id

  const inserted = await db
    .insert(mus.musAlbums)
    .values({
      name: trimmed,
      sortName: sortNameFor(trimmed),
      artistId,
      year: year ?? null,
      isCompilation
    })
    .returning({ id: mus.musAlbums.id })
  return inserted[0]?.id ?? null
}

// -------------------------------------------------------------- counters ----

/** Recompute track count / total runtime for the given albums. */
export async function refreshAlbumCounters(albumIds: Array<number | null>): Promise<void> {
  const ids = [...new Set(albumIds.filter((id): id is number => typeof id === 'number'))]
  if (!ids.length) return

  const stats = await db
    .select({
      albumId: mus.musTracks.albumId,
      count: sql<number>`count(*)::int`,
      duration: sql<number>`coalesce(sum(${mus.musTracks.duration}), 0)`
    })
    .from(mus.musTracks)
    .where(and(inArray(mus.musTracks.albumId, ids), isNull(mus.musTracks.deletedAt)))
    .groupBy(mus.musTracks.albumId)

  const byId = new Map(stats.map(row => [row.albumId, row]))
  for (const id of ids) {
    const row = byId.get(id)
    await db.update(mus.musAlbums)
      .set({ trackCount: row?.count ?? 0, duration: row?.duration ?? 0, updatedAt: new Date() })
      .where(eq(mus.musAlbums.id, id))
  }
}

/** Recompute the track and album counts for the given artists. */
export async function refreshArtistCounters(artistIds: Array<number | null>): Promise<void> {
  const ids = [...new Set(artistIds.filter((id): id is number => typeof id === 'number'))]
  if (!ids.length) return

  const living = isNull(mus.musTracks.deletedAt)
  const [trackStats, albumStats] = await Promise.all([
    db.select({ artistId: mus.musTracks.artistId, count: sql<number>`count(*)::int` })
      .from(mus.musTracks)
      .where(and(inArray(mus.musTracks.artistId, ids), living))
      .groupBy(mus.musTracks.artistId),
    db.select({ artistId: mus.musAlbums.artistId, count: sql<number>`count(*)::int` })
      .from(mus.musAlbums)
      .where(inArray(mus.musAlbums.artistId, ids))
      .groupBy(mus.musAlbums.artistId)
  ])

  const tracks = new Map(trackStats.map(row => [row.artistId, row.count]))
  const albums = new Map(albumStats.map(row => [row.artistId, row.count]))
  for (const id of ids) {
    await db.update(mus.musArtists)
      .set({ trackCount: tracks.get(id) ?? 0, albumCount: albums.get(id) ?? 0, updatedAt: new Date() })
      .where(eq(mus.musArtists.id, id))
  }
}

export async function refreshGenreCounters(genreIds: Array<number | null>): Promise<void> {
  const ids = [...new Set(genreIds.filter((id): id is number => typeof id === 'number'))]
  if (!ids.length) return

  const stats = await db
    .select({ genreId: mus.musTracks.genreId, count: sql<number>`count(*)::int` })
    .from(mus.musTracks)
    .where(and(inArray(mus.musTracks.genreId, ids), isNull(mus.musTracks.deletedAt)))
    .groupBy(mus.musTracks.genreId)

  const byId = new Map(stats.map(row => [row.genreId, row.count]))
  for (const id of ids) {
    await db.update(mus.musGenres)
      .set({ trackCount: byId.get(id) ?? 0, updatedAt: new Date() })
      .where(eq(mus.musGenres.id, id))
  }
}

// ------------------------------------------------------------- hydration ----

const trackArtist = alias(mus.musArtists, 'track_artist')
const albumArtist = alias(mus.musArtists, 'album_artist')

/** The track projection every listing endpoint shares. */
export const TRACK_COLUMNS = {
  id: mus.musTracks.id,
  title: mus.musTracks.title,
  duration: mus.musTracks.duration,
  format: mus.musTracks.format,
  mimeType: mus.musTracks.mimeType,
  size: mus.musTracks.size,
  bitrate: mus.musTracks.bitrate,
  sampleRate: mus.musTracks.sampleRate,
  channels: mus.musTracks.channels,
  trackNo: mus.musTracks.trackNo,
  discNo: mus.musTracks.discNo,
  year: mus.musTracks.year,
  isPublic: mus.musTracks.isPublic,
  playCount: mus.musTracks.playCount,
  lastPlayedAt: mus.musTracks.lastPlayedAt,
  createdAt: mus.musTracks.createdAt,
  userId: mus.musTracks.userId,
  hasLyrics: sql<boolean>`(${mus.musTracks.lyrics} is not null)`.as('has_lyrics'),
  path: mus.musTracks.path,
  cover: mus.musTracks.cover,
  artistId: mus.musTracks.artistId,
  albumArtistId: mus.musTracks.albumArtistId,
  albumId: mus.musTracks.albumId,
  genreId: mus.musTracks.genreId,
  artistName: trackArtist.name,
  albumArtistName: albumArtist.name,
  albumName: mus.musAlbums.name,
  albumCover: mus.musAlbums.cover,
  genreName: mus.musGenres.name
}

/** Base query: tracks joined to the names a client actually needs to show. */
export function trackQuery() {
  return db
    .select(TRACK_COLUMNS)
    .from(mus.musTracks)
    .leftJoin(trackArtist, eq(mus.musTracks.artistId, trackArtist.id))
    .leftJoin(albumArtist, eq(mus.musTracks.albumArtistId, albumArtist.id))
    .leftJoin(mus.musAlbums, eq(mus.musTracks.albumId, mus.musAlbums.id))
    .leftJoin(mus.musGenres, eq(mus.musTracks.genreId, mus.musGenres.id))
}

export type TrackRow = Awaited<ReturnType<typeof trackQuery>>[number]

export interface TrackDTO {
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
  lastPlayedAt: Date | null
  createdAt: Date
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

/** Which of these entities the viewer has starred, as sets. */
export async function starredIds(viewer: Viewer, type: string, ids: number[]): Promise<Set<number>> {
  if (viewer.userId == null || !ids.length) return new Set()
  const rows = await db
    .select({ entityId: mus.musStars.entityId })
    .from(mus.musStars)
    .where(and(
      eq(mus.musStars.userId, viewer.userId),
      eq(mus.musStars.entityType, type),
      inArray(mus.musStars.entityId, ids)
    ))
  return new Set(rows.map(row => row.entityId))
}

/** Attach cover URL, stream URL, starred flag and edit rights to track rows. */
export async function hydrateTracks(rows: TrackRow[], viewer: Viewer): Promise<TrackDTO[]> {
  const starred = await starredIds(viewer, 'track', rows.map(row => row.id))
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    duration: row.duration,
    format: row.format,
    mimeType: row.mimeType,
    size: row.size,
    bitrate: row.bitrate,
    sampleRate: row.sampleRate,
    channels: row.channels,
    trackNo: row.trackNo,
    discNo: row.discNo,
    year: row.year,
    isPublic: row.isPublic,
    playCount: row.playCount,
    lastPlayedAt: row.lastPlayedAt,
    createdAt: row.createdAt,
    hasLyrics: Boolean(row.hasLyrics),
    artistId: row.artistId,
    artistName: row.artistName,
    albumArtistId: row.albumArtistId,
    albumArtistName: row.albumArtistName,
    albumId: row.albumId,
    albumName: row.albumName,
    genreId: row.genreId,
    genreName: row.genreName,
    // A track without its own art inherits the album's.
    coverUrl: coverUrl(row.cover ?? row.albumCover),
    streamUrl: `/api/music/tracks/${row.id}/stream`,
    starred: starred.has(row.id),
    canEdit: canEditTrack(viewer, row)
  }))
}

// ---------------------------------------------------------------- albums ----

export const ALBUM_COLUMNS = {
  id: mus.musAlbums.id,
  name: mus.musAlbums.name,
  year: mus.musAlbums.year,
  cover: mus.musAlbums.cover,
  trackCount: mus.musAlbums.trackCount,
  duration: mus.musAlbums.duration,
  playCount: mus.musAlbums.playCount,
  isCompilation: mus.musAlbums.isCompilation,
  artistId: mus.musAlbums.artistId,
  artistName: albumArtist.name,
  createdAt: mus.musAlbums.createdAt
}

export function albumQuery() {
  return db
    .select(ALBUM_COLUMNS)
    .from(mus.musAlbums)
    .leftJoin(albumArtist, eq(mus.musAlbums.artistId, albumArtist.id))
}

export type AlbumRow = Awaited<ReturnType<typeof albumQuery>>[number]

export interface AlbumDTO {
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
  createdAt: Date
  starred: boolean
}

export async function hydrateAlbums(rows: AlbumRow[], viewer: Viewer): Promise<AlbumDTO[]> {
  const starred = await starredIds(viewer, 'album', rows.map(row => row.id))
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    year: row.year,
    trackCount: row.trackCount,
    duration: row.duration,
    playCount: row.playCount,
    isCompilation: row.isCompilation,
    artistId: row.artistId,
    artistName: row.artistName,
    coverUrl: coverUrl(row.cover),
    createdAt: row.createdAt,
    starred: starred.has(row.id)
  }))
}

// --------------------------------------------------------------- artists ----

export const ARTIST_COLUMNS = {
  id: mus.musArtists.id,
  name: mus.musArtists.name,
  cover: mus.musArtists.cover,
  trackCount: mus.musArtists.trackCount,
  albumCount: mus.musArtists.albumCount,
  playCount: mus.musArtists.playCount,
  createdAt: mus.musArtists.createdAt
}

export function artistQuery() {
  return db.select(ARTIST_COLUMNS).from(mus.musArtists)
}

export type ArtistRow = Awaited<ReturnType<typeof artistQuery>>[number]

export interface ArtistDTO {
  id: number
  name: string
  trackCount: number
  albumCount: number
  playCount: number
  coverUrl: string | null
  starred: boolean
}

export async function hydrateArtists(rows: ArtistRow[], viewer: Viewer): Promise<ArtistDTO[]> {
  const ids = rows.map(row => row.id)
  const starred = await starredIds(viewer, 'artist', ids)

  // Fall back to an album cover when the artist has no art of its own — that is
  // what Navidrome-style artist grids look like.
  const coverRows = ids.length
    ? await db
        .select({ artistId: mus.musAlbums.artistId, cover: mus.musAlbums.cover })
        .from(mus.musAlbums)
        .where(inArray(mus.musAlbums.artistId, ids))
    : []
  const coverByArtist = new Map<number, string>()
  for (const row of coverRows) {
    if (row.artistId != null && row.cover && !coverByArtist.has(row.artistId)) {
      coverByArtist.set(row.artistId, row.cover)
    }
  }

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    trackCount: row.trackCount,
    albumCount: row.albumCount,
    playCount: row.playCount,
    coverUrl: coverUrl(row.cover ?? coverByArtist.get(row.id)),
    starred: starred.has(row.id)
  }))
}
