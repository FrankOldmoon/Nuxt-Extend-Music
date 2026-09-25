/**
 * Music — list genres with their track counts.
 */
import { and, asc, desc, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as mus from '../../../database/schema'
import { getViewer, visibleGenreCondition } from '../../../utils/catalogue'
import { likePattern, textParam } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getViewer(event)
  const query = getQuery(event) as Record<string, unknown>

  const filters = [visibleGenreCondition(viewer)]
  const term = textParam(query.q, 120)
  if (term) filters.push(sql`${mus.musGenres.name} ilike ${likePattern(term)}`)

  const sort = String(query.sort ?? 'name')
  const order = sort === 'tracks' ? desc(mus.musGenres.trackCount) : asc(mus.musGenres.name)

  const rows = await db
    .select({
      id: mus.musGenres.id,
      name: mus.musGenres.name,
      slug: mus.musGenres.slug,
      trackCount: mus.musGenres.trackCount
    })
    .from(mus.musGenres)
    .where(and(...filters))
    .orderBy(order)

  return { items: rows, total: rows.length }
})
