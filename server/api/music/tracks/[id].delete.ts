/**
 * Music — soft-delete a track. The audio file stays on disk, so restoring it is
 * free; counters for its artist/album/genre are brought back up to date.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import { requireUser } from '../../../../../../server/utils/auth'
import * as mus from '../../../database/schema'
import { canEditTrack, getViewer } from '../../../utils/catalogue'
import { softDeleteTracks } from '../../../utils/import'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid track id' })
  }

  const [track] = await db
    .select()
    .from(mus.musTracks)
    .where(and(eq(mus.musTracks.id, id), isNull(mus.musTracks.deletedAt)))
    .limit(1)
  if (!track) throw createError({ statusCode: 404, statusMessage: 'Track not found' })

  const viewer = await getViewer(event)
  if (!canEditTrack(viewer, track)) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot delete this track' })
  }

  await softDeleteTracks([id])
  return { ok: true }
})
