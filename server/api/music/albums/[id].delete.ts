/**
 * Music — soft-delete an album together with its tracks.
 *
 * Deleting an album that still holds tracks would leave orphaned rows behind, so
 * they go to the recycle bin with it (and come back together).
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import { requireUser } from '../../../../../../server/utils/auth'
import * as mus from '../../../database/schema'
import { getViewer } from '../../../utils/catalogue'
import { softDeleteTracks } from '../../../utils/import'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid album id' })
  }

  const [album] = await db
    .select()
    .from(mus.musAlbums)
    .where(and(eq(mus.musAlbums.id, id), isNull(mus.musAlbums.deletedAt)))
    .limit(1)
  if (!album) throw createError({ statusCode: 404, statusMessage: 'Album not found' })

  const viewer = await getViewer(event)
  if (!viewer.admin && viewer.userId == null) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot delete this album' })
  }

  const tracks = await db
    .select({ id: mus.musTracks.id })
    .from(mus.musTracks)
    .where(and(eq(mus.musTracks.albumId, id), isNull(mus.musTracks.deletedAt)))

  await softDeleteTracks(tracks.map(track => track.id))

  const now = new Date()
  await db.update(mus.musAlbums)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(mus.musAlbums.id, id))

  return { ok: true, tracksDeleted: tracks.length }
})
