/**
 * Music — rename a playlist, change its description or its visibility.
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
    throw createError({ statusCode: 403, statusMessage: 'You cannot modify this playlist' })
  }

  const body = await readBody<{ name?: string, description?: string | null, isPublic?: boolean }>(event)
  const sets: Partial<typeof mus.musPlaylists.$inferInsert> = {}

  if ('name' in body) {
    const name = String(body.name ?? '').trim()
    if (!name) throw createError({ statusCode: 400, statusMessage: 'name cannot be empty' })
    sets.name = name.slice(0, 300)
  }
  if ('description' in body) {
    const description = String(body.description ?? '').trim()
    sets.description = description ? description.slice(0, 2000) : null
  }
  if ('isPublic' in body) sets.isPublic = Boolean(body.isPublic)

  if (Object.keys(sets).length) {
    sets.updatedAt = new Date()
    await db.update(mus.musPlaylists).set(sets).where(eq(mus.musPlaylists.id, id))
  }

  return { ok: true }
})
