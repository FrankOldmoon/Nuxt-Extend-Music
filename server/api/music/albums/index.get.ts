/**
 * Music — list albums (the grid view).
 */
import { and, asc, desc, eq, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as mus from '../../../database/schema'
import { albumQuery, getViewer, hydrateAlbums, visibleAlbumCondition } from '../../../utils/catalogue'
import { intParam, likePattern, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getViewer(event)
  const query = getQuery(event) as Record<string, unknown>
  const { limit, offset, page, pageSize } = pagination(query, 60)

  const filters = [visibleAlbumCondition(viewer)]

  const artistId = intParam(query.artistId)
  if (artistId) filters.push(eq(mus.musAlbums.artistId, artistId))

  const term = textParam(query.q, 120)
  if (term) {
    const pattern = likePattern(term)
    filters.push(or(
      sql`${mus.musAlbums.name} ilike ${pattern}`,
      sql`exists (select 1 from mus_artists a where a.id = ${mus.musAlbums.artistId} and a.name ilike ${pattern})`
    )!)
  }

  const where = and(...filters)
  const sort = String(query.sort ?? 'name')
  const order = sort === 'recent'
    ? desc(mus.musAlbums.createdAt)
    : sort === 'plays'
      ? desc(mus.musAlbums.playCount)
      : asc(mus.musAlbums.sortName)

  const [rows, [count]] = await Promise.all([
    albumQuery().where(where).orderBy(order).limit(limit).offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(mus.musAlbums).where(where)
  ])

  return { items: await hydrateAlbums(rows, viewer), total: count?.n ?? 0, page, pageSize }
})
