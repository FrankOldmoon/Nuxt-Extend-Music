/**
 * Music module — playlist helpers.
 *
 * Playlists are visible to their owner, to admins, and to everyone when they are
 * public (Navidrome calls these shared playlists); a public playlist of private
 * tracks still only exposes the tracks the viewer may see.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../../../server/database'
import * as mus from '../database/schema'
import type { Viewer } from './catalogue'
import { trackVisibility } from './catalogue'

export interface PlaylistRow {
  id: number
  name: string
  userId: number | null
  isPublic: boolean
  deletedAt: Date | null
}

/** Public playlists are readable by anyone; private ones only by owner/admin. */
export function canViewPlaylist(viewer: Viewer, playlist: PlaylistRow): boolean {
  if (viewer.admin) return true
  if (playlist.isPublic) return true
  return viewer.userId != null && playlist.userId === viewer.userId
}

/** Only the owner (or an admin) may change a playlist. */
export function canEditPlaylist(viewer: Viewer, playlist: PlaylistRow): boolean {
  if (viewer.admin) return true
  return viewer.userId != null && playlist.userId === viewer.userId
}

/** The next free position at the end of a playlist. */
export async function nextSortOrder(playlistId: number): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(sort_order), -1)::int` })
    .from(mus.musPlaylistTracks)
    .where(eq(mus.musPlaylistTracks.playlistId, playlistId))
  return (row?.max ?? -1) + 1
}

/** Recompute the track count, total runtime and cover of a playlist. */
export async function refreshPlaylistStats(playlistId: number): Promise<void> {
  const [stats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      duration: sql<number>`coalesce(sum(t.duration), 0)`
    })
    .from(mus.musPlaylistTracks)
    .innerJoin(mus.musTracks, eq(mus.musPlaylistTracks.trackId, mus.musTracks.id))
    .where(and(eq(mus.musPlaylistTracks.playlistId, playlistId), isNull(mus.musTracks.deletedAt)))

  // The first track's art is the playlist cover, unless one was set explicitly.
  const [first] = await db
    .select({ cover: mus.musTracks.cover, albumCover: mus.musAlbums.cover })
    .from(mus.musPlaylistTracks)
    .innerJoin(mus.musTracks, eq(mus.musPlaylistTracks.trackId, mus.musTracks.id))
    .leftJoin(mus.musAlbums, eq(mus.musTracks.albumId, mus.musAlbums.id))
    .where(and(eq(mus.musPlaylistTracks.playlistId, playlistId), isNull(mus.musTracks.deletedAt)))
    .orderBy(asc(mus.musPlaylistTracks.sortOrder))
    .limit(1)

  const [playlist] = await db
    .select({ cover: mus.musPlaylists.cover })
    .from(mus.musPlaylists)
    .where(eq(mus.musPlaylists.id, playlistId))
    .limit(1)

  await db.update(mus.musPlaylists)
    .set({
      trackCount: stats?.count ?? 0,
      duration: stats?.duration ?? 0,
      cover: playlist?.cover ?? first?.cover ?? first?.albumCover ?? null,
      updatedAt: new Date()
    })
    .where(eq(mus.musPlaylists.id, playlistId))
}

/**
 * Renumber a playlist after an edit.
 *
 * Positions are rewritten wholesale (0, 1, 2 …) so gaps left by removals cannot
 * accumulate into a stale ordering.
 */
export async function compactPlaylistOrder(playlistId: number): Promise<void> {
  const rows = await db
    .select({ id: mus.musPlaylistTracks.id })
    .from(mus.musPlaylistTracks)
    .where(eq(mus.musPlaylistTracks.playlistId, playlistId))
    .orderBy(asc(mus.musPlaylistTracks.sortOrder), asc(mus.musPlaylistTracks.id))

  for (const [index, row] of rows.entries()) {
    await db.update(mus.musPlaylistTracks)
      .set({ sortOrder: index })
      .where(eq(mus.musPlaylistTracks.id, row.id))
  }
}

/** Apply an explicit order (ids not listed keep their relative position at the end). */
export async function applyPlaylistOrder(playlistId: number, trackIds: number[]): Promise<void> {
  if (!trackIds.length) return
  const existing = await db
    .select({ id: mus.musPlaylistTracks.id, trackId: mus.musPlaylistTracks.trackId })
    .from(mus.musPlaylistTracks)
    .where(eq(mus.musPlaylistTracks.playlistId, playlistId))

  const byTrack = new Map(existing.map(row => [row.trackId, row.id]))
  let position = 0
  for (const trackId of trackIds) {
    const rowId = byTrack.get(trackId)
    if (rowId == null) continue
    await db.update(mus.musPlaylistTracks).set({ sortOrder: position }).where(eq(mus.musPlaylistTracks.id, rowId))
    position++
  }
  await compactPlaylistOrder(playlistId)
}

/** Whether these track ids exist and the viewer may see them. */
export async function visibleTrackIds(viewer: Viewer, trackIds: number[]): Promise<number[]> {
  if (!trackIds.length) return []
  const rows = await db
    .select({ id: mus.musTracks.id })
    .from(mus.musTracks)
    .where(and(inArray(mus.musTracks.id, trackIds), trackVisibility(viewer)))
  return rows.map(row => row.id)
}

/** Create an empty playlist; returns its id. */
export async function createPlaylist(input: {
  name: string
  description: string | null
  isPublic: boolean
  userId: number | null
}): Promise<number> {
  const [row] = await db
    .insert(mus.musPlaylists)
    .values({
      name: input.name,
      description: input.description,
      isPublic: input.isPublic,
      userId: input.userId
    })
    .returning({ id: mus.musPlaylists.id })
  return row!.id
}

/**
 * Append tracks, skipping any the viewer may not see and any already present.
 * Returns how many were actually added.
 */
export async function addTracksToPlaylist(playlistId: number, trackIds: number[], viewer: Viewer): Promise<number> {
  const allowed = await visibleTrackIds(viewer, trackIds)
  if (!allowed.length) return 0

  let position = await nextSortOrder(playlistId)
  for (const trackId of allowed) {
    await db
      .insert(mus.musPlaylistTracks)
      .values({ playlistId, trackId, sortOrder: position })
      .onConflictDoNothing()
    position++
  }
  await compactPlaylistOrder(playlistId)
  await refreshPlaylistStats(playlistId)
  return allowed.length
}

/** Remove tracks from a playlist and renumber what is left. */
export async function removeTracksFromPlaylist(playlistId: number, trackIds: number[]): Promise<number> {
  if (!trackIds.length) return 0
  const result = await db
    .delete(mus.musPlaylistTracks)
    .where(and(
      eq(mus.musPlaylistTracks.playlistId, playlistId),
      inArray(mus.musPlaylistTracks.trackId, trackIds)
    ))
  await compactPlaylistOrder(playlistId)
  await refreshPlaylistStats(playlistId)
  return result.rowCount ?? 0
}
