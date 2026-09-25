/**
 * Music — edit a playlist's contents.
 *
 * One endpoint covers all three edits (add / remove / reorder) because they share
 * the same permission check and the same "renumber afterwards" step; keeping them
 * together is what stops the ordering from drifting.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../../server/database'
import { requireUser } from '../../../../../../../server/utils/auth'
import * as mus from '../../../../database/schema'
import { getViewer } from '../../../../utils/catalogue'
import {
  addTracksToPlaylist,
  applyPlaylistOrder,
  canEditPlaylist,
  removeTracksFromPlaylist,
  refreshPlaylistStats
} from '../../../../utils/playlists'

const ACTIONS = ['add', 'remove', 'order'] as const

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

  const body = await readBody<{ action?: string, trackIds?: unknown[] }>(event)
  const action = ACTIONS.find(candidate => candidate === body?.action)
  if (!action) throw createError({ statusCode: 400, statusMessage: 'action must be add, remove or order' })

  const trackIds = (Array.isArray(body?.trackIds) ? body.trackIds : [])
    .map(Number)
    .filter(value => Number.isInteger(value) && value > 0)
  if (!trackIds.length) throw createError({ statusCode: 400, statusMessage: 'trackIds is required' })

  if (action === 'add') {
    const added = await addTracksToPlaylist(id, trackIds, viewer)
    return { ok: true, action, added }
  }
  if (action === 'remove') {
    const removed = await removeTracksFromPlaylist(id, trackIds)
    return { ok: true, action, removed }
  }

  await applyPlaylistOrder(id, trackIds)
  await refreshPlaylistStats(id)
  return { ok: true, action }
})
