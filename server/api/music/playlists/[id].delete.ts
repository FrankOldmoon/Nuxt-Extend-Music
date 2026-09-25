/**
 * Music — delete a playlist (the tracks themselves are untouched).
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import { requireUser } from '../../../../../../server/utils/auth'
import * as mus from '../../../database/schema'
import { getViewer } from '../../../utils/catalogue'
import { canEditPlaylist } from '../../../utils/playlists'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid playlist id' })
  }

  const [playlist] = await db
    .select()
    .from(mus.musPlaylists)
    .where(and(eq(mus.musPlaylists.id, id), isNull(mus.musPlaylists.deletedAt)))
    .limit(1)
  if (!playlist) throw createError({ statusCode: 404, statusMessage: 'Playlist not found' })

  const viewer = await getViewer(event)
  if (!canEditPlaylist(viewer, playlist)) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot delete this playlist' })
  }

  const now = new Date()
  await db.update(mus.musPlaylists)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(mus.musPlaylists.id, id))

  return { ok: true }
})
