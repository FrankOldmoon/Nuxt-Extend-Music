/**
 * Music — one album with its track list.
 */
import { and, asc, eq } from 'drizzle-orm'
import * as mus from '../../../database/schema'
import {
  albumQuery,
  getViewer,
  hydrateAlbums,
  hydrateTracks,
  trackQuery,
  trackVisibility,
  visibleAlbumCondition
} from '../../../utils/catalogue'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid album id' })
  }

  const viewer = await getViewer(event)
  const [row] = await albumQuery()
    .where(and(eq(mus.musAlbums.id, id), visibleAlbumCondition(viewer)))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Album not found' })

  const tracks = await trackQuery()
    .where(and(eq(mus.musTracks.albumId, id), trackVisibility(viewer)))
    .orderBy(asc(mus.musTracks.discNo), asc(mus.musTracks.trackNo), asc(mus.musTracks.id))

  const [album] = await hydrateAlbums([row], viewer)
  return { album, tracks: await hydrateTracks(tracks, viewer) }
})
