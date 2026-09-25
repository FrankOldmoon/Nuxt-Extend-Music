/**
 * Music — one artist: their albums and every playable track.
 */
import { and, asc, eq, isNull, or } from 'drizzle-orm'
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
  visibleArtistCondition
} from '../../../utils/catalogue'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid artist id' })
  }

  const viewer = await getViewer(event)
  const [row] = await artistQuery()
    .where(and(eq(mus.musArtists.id, id), visibleArtistCondition(viewer)))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Artist not found' })

  const [albums, tracks] = await Promise.all([
    albumQuery()
      .where(and(eq(mus.musAlbums.artistId, id), isNull(mus.musAlbums.deletedAt)))
      .orderBy(asc(mus.musAlbums.year), asc(mus.musAlbums.sortName)),
    trackQuery()
      .where(and(
        or(eq(mus.musTracks.artistId, id), eq(mus.musTracks.albumArtistId, id)),
        trackVisibility(viewer)
      ))
      .orderBy(asc(mus.musTracks.albumId), asc(mus.musTracks.discNo), asc(mus.musTracks.trackNo), asc(mus.musTracks.id))
      .limit(500)
  ])

  const [artist] = await hydrateArtists([row], viewer)
  return {
    artist,
    albums: await hydrateAlbums(albums, viewer),
    tracks: await hydrateTracks(tracks, viewer)
  }
})
