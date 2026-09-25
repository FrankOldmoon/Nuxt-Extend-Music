/**
 * Music — list artists.
 */
import { and, asc, desc, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as mus from '../../../database/schema'
import { artistQuery, getViewer, hydrateArtists, visibleArtistCondition } from '../../../utils/catalogue'
import { likePattern, pagination, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getViewer(event)
  const query = getQuery(event) as Record<string, unknown>
  const { limit, offset, page, pageSize } = pagination(query, 60)

  const filters = [visibleArtistCondition(viewer)]
  const term = textParam(query.q, 120)
  if (term) filters.push(sql`${mus.musArtists.name} ilike ${likePattern(term)}`)

  const where = and(...filters)
  const sort = String(query.sort ?? 'name')
  const order = sort === 'tracks'
    ? desc(mus.musArtists.trackCount)
    : sort === 'plays'
      ? desc(mus.musArtists.playCount)
      : asc(mus.musArtists.sortName)

  const [rows, [count]] = await Promise.all([
    artistQuery().where(where).orderBy(order).limit(limit).offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(mus.musArtists).where(where)
  ])

  return { items: await hydrateArtists(rows, viewer), total: count?.n ?? 0, page, pageSize }
})
