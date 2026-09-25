/**
 * Music — one genre with its tracks.
 */
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as mus from '../../../database/schema'
import {
  getViewer,
  hydrateTracks,
  trackQuery,
  trackVisibility,
  visibleGenreCondition
} from '../../../utils/catalogue'
import { pagination } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid genre id' })
  }

  const viewer = await getViewer(event)
  const { limit, offset, page, pageSize } = pagination(getQuery(event) as Record<string, unknown>, 200)

  const [genre] = await db
    .select({ id: mus.musGenres.id, name: mus.musGenres.name, slug: mus.musGenres.slug })
    .from(mus.musGenres)
    .where(and(eq(mus.musGenres.id, id), visibleGenreCondition(viewer)))
    .limit(1)
  if (!genre) throw createError({ statusCode: 404, statusMessage: 'Genre not found' })

  const tracks = await trackQuery()
    .where(and(eq(mus.musTracks.genreId, id), trackVisibility(viewer)))
    // Ordered by the artist/album *ids*: the names are joined aliases, which
    // would cost an extra join just to sort by.
    .orderBy(asc(mus.musTracks.artistId), asc(mus.musTracks.albumId), asc(mus.musTracks.trackNo))
    .limit(limit)
    .offset(offset)

  return { genre, tracks: await hydrateTracks(tracks, viewer), page, pageSize }
})
