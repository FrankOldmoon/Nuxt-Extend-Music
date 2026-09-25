/**
 * Music — one playlist with its tracks.
 *
 * A public playlist is readable without signing in (that is what makes the home
 * page's playlist row work for anonymous visitors), but each track is still
 * filtered through the viewer's visibility rule.
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as mus from '../../../database/schema'
import { coverUrl, getViewer, hydrateTracks, trackQuery, trackVisibility } from '../../../utils/catalogue'
import { canEditPlaylist, canViewPlaylist } from '../../../utils/playlists'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid playlist id' })
  }

  const viewer = await getViewer(event)
  const [playlist] = await db
    .select()
    .from(mus.musPlaylists)
    .where(and(eq(mus.musPlaylists.id, id), isNull(mus.musPlaylists.deletedAt)))
    .limit(1)
  if (!playlist || !canViewPlaylist(viewer, playlist)) {
    throw createError({ statusCode: 404, statusMessage: 'Playlist not found' })
  }

  // The playlist's own order, not the track's natural one.
  const rows = await trackQuery()
    .innerJoin(mus.musPlaylistTracks, eq(mus.musPlaylistTracks.trackId, mus.musTracks.id))
    .where(and(eq(mus.musPlaylistTracks.playlistId, id), trackVisibility(viewer)))
    .orderBy(asc(mus.musPlaylistTracks.sortOrder))

  return {
    playlist: {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      coverUrl: coverUrl(playlist.cover),
      isPublic: playlist.isPublic,
      userId: playlist.userId,
      trackCount: playlist.trackCount,
      duration: playlist.duration,
      updatedAt: playlist.updatedAt,
      canEdit: canEditPlaylist(viewer, playlist)
    },
    tracks: await hydrateTracks(rows, viewer)
  }
})
