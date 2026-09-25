/**
 * Music — home page aggregation.
 *
 * Anonymous-friendly by construction: every query goes through the viewer's
 * visibility rule, so a signed-out visitor gets a complete page built from the
 * public tracks rather than a login wall.
 */
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { db } from '../../../../../server/database'
import * as mus from '../../database/schema'
import {
  albumQuery,
  getViewer,
  hydrateAlbums,
  hydrateTracks,
  trackQuery,
  trackVisibility,
  visibleAlbumCondition,
  visibleArtistCondition,
  visibleGenreCondition
} from '../../utils/catalogue'

export default defineEventHandler(async (event) => {
  const viewer = await getViewer(event)
  const visibility = trackVisibility(viewer)
  const random = sql`random()`

  const [totals] = await db
    .select({
      tracks: sql<number>`count(*)::int`,
      duration: sql<number>`coalesce(sum(${mus.musTracks.duration}), 0)`
    })
    .from(mus.musTracks)
    .where(visibility)

  const [[albumTotal], [artistTotal], [genreTotal]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(mus.musAlbums).where(visibleAlbumCondition(viewer)),
    db.select({ n: sql<number>`count(*)::int` }).from(mus.musArtists).where(visibleArtistCondition(viewer)),
    db.select({ n: sql<number>`count(*)::int` }).from(mus.musGenres).where(visibleGenreCondition(viewer))
  ])

  const [recentTracks, mostPlayed, recentAlbums, randomAlbums] = await Promise.all([
    trackQuery()
      .where(visibility)
      .orderBy(desc(mus.musTracks.createdAt), desc(mus.musTracks.id))
      .limit(12),
    trackQuery()
      .where(and(visibility, gt(mus.musTracks.playCount, 0)))
      .orderBy(desc(mus.musTracks.playCount), desc(mus.musTracks.lastPlayedAt))
      .limit(12),
    albumQuery()
      .where(visibleAlbumCondition(viewer))
      .orderBy(desc(mus.musAlbums.createdAt))
      .limit(12),
    albumQuery()
      .where(visibleAlbumCondition(viewer))
      .orderBy(random)
      .limit(12)
  ])

  // Recently played: distinct tracks, most recent first. Only the tail of the
  // log is read, so this stays cheap however long the history grows.
  const history = await db
    .select({ trackId: mus.musPlayHistory.trackId })
    .from(mus.musPlayHistory)
    .orderBy(desc(mus.musPlayHistory.playedAt))
    .limit(200)

  const seen = new Set<number>()
  const recentIds: number[] = []
  for (const row of history) {
    if (seen.has(row.trackId)) continue
    seen.add(row.trackId)
    recentIds.push(row.trackId)
    if (recentIds.length >= 12) break
  }

  const recentRows = recentIds.length
    ? await trackQuery().where(and(visibility, inArray(mus.musTracks.id, recentIds)))
    : []
  const byId = new Map(recentRows.map(row => [row.id, row]))
  const orderedRecent = recentIds
    .map(id => byId.get(id))
    .filter((row): row is (typeof recentRows)[number] => !!row)

  // Public playlists are part of the landing page for everyone.
  const playlists = await db
    .select({
      id: mus.musPlaylists.id,
      name: mus.musPlaylists.name,
      cover: mus.musPlaylists.cover,
      trackCount: mus.musPlaylists.trackCount,
      duration: mus.musPlaylists.duration,
      isPublic: mus.musPlaylists.isPublic,
      userId: mus.musPlaylists.userId
    })
    .from(mus.musPlaylists)
    .where(and(
      sql`${mus.musPlaylists.deletedAt} is null`,
      viewer.userId == null
        ? eq(mus.musPlaylists.isPublic, true)
        : sql`(${mus.musPlaylists.isPublic} = true or ${mus.musPlaylists.userId} = ${viewer.userId})`
    ))
    .orderBy(desc(mus.musPlaylists.updatedAt))
    .limit(8)

  return {
    viewer: { signedIn: viewer.userId != null, admin: viewer.admin },
    stats: {
      tracks: totals?.tracks ?? 0,
      albums: albumTotal?.n ?? 0,
      artists: artistTotal?.n ?? 0,
      genres: genreTotal?.n ?? 0,
      duration: totals?.duration ?? 0
    },
    recentlyAdded: await hydrateTracks(recentTracks, viewer),
    mostPlayed: await hydrateTracks(mostPlayed, viewer),
    recentlyPlayed: await hydrateTracks(orderedRecent, viewer),
    recentAlbums: await hydrateAlbums(recentAlbums, viewer),
    randomAlbums: await hydrateAlbums(randomAlbums, viewer),
    playlists
  }
})
