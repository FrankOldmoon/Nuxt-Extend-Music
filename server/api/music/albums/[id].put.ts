/**
 * Music — rename an album or fix its year.
 *
 * Renaming can merge two albums (when the new name collides with an existing
 * one for the same artist), which is usually exactly what a user wants after a
 * tagging mistake: the tracks move across and the empty album is dropped.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import { requireUser } from '../../../../../../server/utils/auth'
import * as mus from '../../../database/schema'
import { ensureAlbum, getViewer, refreshAlbumCounters, sortNameFor } from '../../../utils/catalogue'

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

  const body = await readBody<{ name?: string, year?: number | null, isPublic?: boolean }>(event)
  const viewer = await getViewer(event)
  if (!viewer.admin && viewer.userId == null) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot modify this album' })
  }

  const sets: Partial<typeof mus.musAlbums.$inferInsert> = {}

  if ('name' in body) {
    const name = String(body.name ?? '').trim()
    if (!name) throw createError({ statusCode: 400, statusMessage: 'name cannot be empty' })

    const target = await ensureAlbum(name, album.artistId, album.year, album.isCompilation)
    if (target && target !== id) {
      // Merge: move the tracks onto the surviving album, then refresh both.
      const moved = await db.update(mus.musTracks)
        .set({ albumId: target, updatedAt: new Date() })
        .where(eq(mus.musTracks.albumId, id))
      const surviving = await db
        .select({ cover: mus.musAlbums.cover })
        .from(mus.musAlbums)
        .where(eq(mus.musAlbums.id, target))
        .limit(1)
      if (!surviving[0]?.cover && album.cover) {
        await db.update(mus.musAlbums).set({ cover: album.cover }).where(eq(mus.musAlbums.id, target))
      }
      await db.update(mus.musAlbums)
        .set({ deletedAt: new Date(), trackCount: 0, duration: 0, updatedAt: new Date() })
        .where(eq(mus.musAlbums.id, id))
      await refreshAlbumCounters([id, target])
      return { ok: true, merged: true, movedTracks: moved.rowCount ?? 0, albumId: target }
    }

    sets.name = name
    sets.sortName = sortNameFor(name)
  }

  if ('year' in body) sets.year = Number.isFinite(Number(body.year)) ? Number(body.year) : null

  if (Object.keys(sets).length) {
    sets.updatedAt = new Date()
    await db.update(mus.musAlbums).set(sets).where(eq(mus.musAlbums.id, id))
  }

  return { ok: true, merged: false }
})
