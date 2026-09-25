/**
 * Music — the viewer's starred items.
 *
 * Without `type` this returns just the counts per kind (cheap, for badges);
 * with `type` it returns the hydrated entities, which is what the favourites
 * page renders.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as mus from '../../../database/schema'
import {
  albumQuery,
  artistQuery,
  getViewer,
  hydrateAlbums,
  hydrateArtists,
  hydrateTracks,
  trackQuery,
  trackVisibility,
  visibleAlbumCondition,
  visibleArtistCondition
} from '../../../utils/catalogue'
import { pagination } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getViewer(event)
  if (viewer.userId == null) {
    return { counts: { track: 0, album: 0, artist: 0 }, items: [], total: 0, signedIn: false }
  }

  const query = getQuery(event) as Record<string, unknown>
  const counts = await db
    .select({ type: mus.musStars.entityType, n: sql<number>`count(*)::int` })
    .from(mus.musStars)
    .where(eq(mus.musStars.userId, viewer.userId))
    .groupBy(mus.musStars.entityType)

  const counted = { track: 0, album: 0, artist: 0 }
  for (const row of counts) {
    if (row.type === 'track' || row.type === 'album' || row.type === 'artist') counted[row.type] = row.n
  }

  const type = String(query.type ?? '')
  if (type !== 'track' && type !== 'album' && type !== 'artist') {
    return { counts: counted, items: [], total: 0, signedIn: true }
  }

  const { limit, offset, page, pageSize } = pagination(query, 100)
  const starredRows = await db
    .select({ entityId: mus.musStars.entityId })
    .from(mus.musStars)
    .where(and(eq(mus.musStars.userId, viewer.userId), eq(mus.musStars.entityType, type)))
    .orderBy(asc(mus.musStars.id))
    .limit(limit)
    .offset(offset)

  const ids = starredRows.map(row => row.entityId)
  if (!ids.length) return { counts: counted, items: [], total: counted[type], page, pageSize, signedIn: true }

  // Starred ids are filtered through the same visibility rule as everywhere
  // else: un-starring is the owner's business, but a deleted or hidden track
  // must not resurface through the favourites list.
  let items: unknown[]
  if (type === 'track') {
    const rows = await trackQuery()
      .where(and(inArray(mus.musTracks.id, ids), trackVisibility(viewer)))
      .limit(limit)
    items = await hydrateTracks(rows, viewer)
  } else if (type === 'album') {
    const rows = await albumQuery()
      .where(and(inArray(mus.musAlbums.id, ids), visibleAlbumCondition(viewer)))
      .limit(limit)
    items = await hydrateAlbums(rows, viewer)
  } else {
    const rows = await artistQuery()
      .where(and(inArray(mus.musArtists.id, ids), visibleArtistCondition(viewer)))
      .limit(limit)
    items = await hydrateArtists(rows, viewer)
  }

  return { counts: counted, items, total: counted[type], page, pageSize, signedIn: true }
})
