/**
 * Music — list tracks.
 *
 * The same endpoint backs the album/artist/genre pages, search, the starred
 * view and the management table; filters simply compose. Works for anonymous
 * callers, who only ever see public tracks.
 */
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as mus from '../../../database/schema'
import { getViewer, hydrateTracks, trackQuery, trackVisibility } from '../../../utils/catalogue'
import { boolParam, intParam, likePattern, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getViewer(event)
  const query = getQuery(event) as Record<string, unknown>
  const { limit, offset, page, pageSize } = pagination(query)

  const filters = [trackVisibility(viewer)]

  const albumId = intParam(query.albumId)
  if (albumId) filters.push(eq(mus.musTracks.albumId, albumId))

  const artistId = intParam(query.artistId)
  if (artistId) {
    // An artist page shows their own tracks and the albums they head.
    filters.push(or(
      eq(mus.musTracks.artistId, artistId),
      eq(mus.musTracks.albumArtistId, artistId)
    )!)
  }

  const genreId = intParam(query.genreId)
  if (genreId) filters.push(eq(mus.musTracks.genreId, genreId))

  const genreName = textParam(query.genre, 200)
  if (genreName) {
    filters.push(sql`exists (select 1 from mus_genres g where g.id = ${mus.musTracks.genreId} and lower(g.name) = lower(${genreName}))`)
  }

  const term = textParam(query.q, 120)
  if (term) {
    const pattern = likePattern(term)
    filters.push(or(
      ilike(mus.musTracks.title, pattern),
      sql`exists (select 1 from mus_artists a where a.id = ${mus.musTracks.artistId} and a.name ilike ${pattern})`,
      sql`exists (select 1 from mus_albums al where al.id = ${mus.musTracks.albumId} and al.name ilike ${pattern})`
    )!)
  }

  if (boolParam(query.starred) && viewer.userId != null) {
    filters.push(sql`exists (select 1 from mus_stars s where s.entity_type = 'track' and s.entity_id = ${mus.musTracks.id} and s.user_id = ${viewer.userId})`)
  }

  const where = and(...filters)

  const order = String(query.order ?? '').toLowerCase() === 'asc' ? asc : desc
  const sortKey = String(query.sort ?? 'created')
  const sortColumn = sortKey === 'title'
    ? mus.musTracks.title
    : sortKey === 'duration'
      ? mus.musTracks.duration
      : sortKey === 'plays'
        ? mus.musTracks.playCount
        : sortKey === 'trackNo'
          ? mus.musTracks.trackNo
          : mus.musTracks.createdAt

  const [rows, [count]] = await Promise.all([
    trackQuery()
      .where(where)
      .orderBy(order(sortColumn), asc(mus.musTracks.id))
      .limit(limit)
      .offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(mus.musTracks).where(where)
  ])

  return {
    items: await hydrateTracks(rows, viewer),
    total: count?.n ?? 0,
    page,
    pageSize
  }
})
