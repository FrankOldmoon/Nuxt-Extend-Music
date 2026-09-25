/**
 * Music — batch operations on tracks (soft delete / restore / rescan).
 *
 * Per-id ownership is checked individually, so one track the caller may not
 * touch cannot fail the whole batch; it is reported in `skipped` instead.
 */
import { inArray } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import { requireUser } from '../../../../../../server/utils/auth'
import * as mus from '../../../database/schema'
import { canEditTrack, getViewer } from '../../../utils/catalogue'
import { rescanTrack, restoreTracks, softDeleteTracks } from '../../../utils/import'

const ACTIONS = ['soft-delete', 'restore', 'rescan'] as const

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const viewer = await getViewer(event)
  const body = await readBody<{ action?: string, ids?: unknown[] }>(event)

  const action = ACTIONS.find(candidate => candidate === body?.action)
  if (!action) throw createError({ statusCode: 400, statusMessage: 'action must be soft-delete, restore or rescan' })

  const ids = (Array.isArray(body?.ids) ? body.ids : [])
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0)
  if (!ids.length) throw createError({ statusCode: 400, statusMessage: 'ids is required' })

  const rows = await db.select().from(mus.musTracks).where(inArray(mus.musTracks.id, ids))
  const byId = new Map(rows.map(row => [row.id, row]))

  const allowed: number[] = []
  const skipped: number[] = []
  for (const id of ids) {
    const track = byId.get(id)
    if (!track || !canEditTrack(viewer, track)) {
      skipped.push(id)
      continue
    }
    allowed.push(id)
  }

  if (action === 'soft-delete') {
    await softDeleteTracks(allowed)
  } else if (action === 'restore') {
    await restoreTracks(allowed)
  } else {
    for (const id of allowed) await rescanTrack(id)
  }

  return { ok: true, action, affected: allowed.length, skipped }
})
