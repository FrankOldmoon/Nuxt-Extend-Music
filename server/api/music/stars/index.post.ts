/**
 * Music — toggle a star on a track, album or artist.
 *
 * Omitting `starred` flips the current state, so the UI can use one button for
 * both directions. Requires a session: stars belong to a user, and anonymous
 * visitors have no shelf to keep them on.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import { requireUser } from '../../../../../../server/utils/auth'
import * as mus from '../../../database/schema'
import { entityVisible, getViewer } from '../../../utils/catalogue'

const TYPES = ['track', 'album', 'artist'] as const
type StarType = typeof TYPES[number]

export default defineEventHandler(async (event) => {
  const ctx = await requireUser(event)
  const body = await readBody<{ type?: string, id?: number, starred?: boolean }>(event)

  const type = TYPES.find(candidate => candidate === body?.type) as StarType | undefined
  const id = Number(body?.id)
  if (!type || !Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'type (track|album|artist) and id are required' })
  }

  const viewer = await getViewer(event)
  if (!(await entityVisible(viewer, type, id))) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const [existing] = await db
    .select({ id: mus.musStars.id })
    .from(mus.musStars)
    .where(and(
      eq(mus.musStars.userId, ctx.user.id),
      eq(mus.musStars.entityType, type),
      eq(mus.musStars.entityId, id)
    ))
    .limit(1)

  const wanted = body?.starred === undefined ? !existing : Boolean(body.starred)

  if (wanted && !existing) {
    await db.insert(mus.musStars)
      .values({ userId: ctx.user.id, entityType: type, entityId: id })
      .onConflictDoNothing()
  } else if (!wanted && existing) {
    await db.delete(mus.musStars).where(eq(mus.musStars.id, existing.id))
  }

  return { starred: wanted, type, id }
})
