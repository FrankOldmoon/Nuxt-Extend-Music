/**
 * Music — unified search across tracks, albums and artists.
 *
 * One request backs the search page, so a query returns a complete picture
 * instead of three round trips. Anonymous callers see public results only.
 */
import { and, asc, desc, ilike, or, sql } from 'drizzle-orm'
import * as mus from '../../database/schema'
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
} from '../../utils/catalogue'
import { likePattern, pagination, textParam } from '../../utils/http'

export default defineEventHandler(async (event) => {
  const viewer = await getViewer(event)
  const query = getQuery(event) as Record<string, unknown>
  const term = textParam(query.q, 120)
  if (!term) return { term: '', tracks: [], albums: [], artists: [], total: 0 }

  const { limit } = pagination(query, 20, 100)
  const pattern = likePattern(term)

  const [tracks, albums, artists] = await Promise.all([
    trackQuery()
      .where(and(
        trackVisibility(viewer),
        or(
          ilike(mus.musTracks.title, pattern),
          sql`exists (select 1 from mus_artists a where a.id = ${mus.musTracks.artistId} and a.name ilike ${pattern})`,
          sql`exists (select 1 from mus_albums al where al.id = ${mus.musTracks.albumId} and al.name ilike ${pattern})`
        )!
      ))
      .orderBy(asc(mus.musTracks.title))
      .limit(limit),
    albumQuery()
      .where(and(
        visibleAlbumCondition(viewer),
        or(
          sql`${mus.musAlbums.name} ilike ${pattern}`,
          sql`exists (select 1 from mus_artists a where a.id = ${mus.musAlbums.artistId} and a.name ilike ${pattern})`
        )!
      ))
      .orderBy(asc(mus.musAlbums.sortName))
      .limit(limit),
    artistQuery()
      .where(and(visibleArtistCondition(viewer), sql`${mus.musArtists.name} ilike ${pattern}`))
      .orderBy(desc(mus.musArtists.trackCount), asc(mus.musArtists.sortName))
      .limit(limit)
  ])

  const [trackItems, albumItems, artistItems] = await Promise.all([
    hydrateTracks(tracks, viewer),
    hydrateAlbums(albums, viewer),
    hydrateArtists(artists, viewer)
  ])

  return {
    term,
    tracks: trackItems,
    albums: albumItems,
    artists: artistItems,
    total: trackItems.length + albumItems.length + artistItems.length
  }
})
