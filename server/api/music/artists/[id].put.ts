/**
 * Music — rename an artist, merging when the new name already exists.
 *
 * Merging is the point: a library that split "Radiohead" across two casings
 * should become one artist again, with the tracks and albums moved across.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import { requireUser } from '../../../../../../server/utils/auth'
import * as mus from '../../../database/schema'
import { refreshArtistCounters, sortNameFor } from '../../../utils/catalogue'

export default defineEventHandler(async (event) => {
  const ctx = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid artist id' })
  }

  const [artist] = await db
    .select()
    .from(mus.musArtists)
    .where(and(eq(mus.musArtists.id, id), isNull(mus.musArtists.deletedAt)))
    .limit(1)
  if (!artist) throw createError({ statusCode: 404, statusMessage: 'Artist not found' })

  const body = await readBody<{ name?: string }>(event)
  const name = String(body?.name ?? '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name cannot be empty' })
  if (name === artist.name) return { ok: true, merged: false, artistId: id }

  const [existing] = await db
    .select({ id: mus.musArtists.id })
    .from(mus.musArtists)
    .where(and(eq(mus.musArtists.name, name), isNull(mus.musArtists.deletedAt)))
    .limit(1)

  const today = new Date()

  if (existing && existing.id !== id) {
    const target = existing.id
    const [tracksMoved, albumsMoved] = await Promise.all([
      db.update(mus.musTracks).set({ artistId: target, updatedAt: today }).where(eq(mus.musTracks.artistId, id)),
      db.update(mus.musAlbums).set({ artistId: target, updatedAt: today }).where(eq(mus.musAlbums.artistId, id))
    ])
    await db.update(mus.musTracks).set({ albumArtistId: target, updatedAt: today }).where(eq(mus.musTracks.albumArtistId, id))
    await db.update(mus.musArtists)
      .set({ deletedAt: today, trackCount: 0, albumCount: 0, updatedAt: today })
      .where(eq(mus.musArtists.id, id))
    await refreshArtistCounters([id, target])
    return {
      ok: true,
      merged: true,
      artistId: target,
      movedTracks: tracksMoved.rowCount ?? 0,
      movedAlbums: albumsMoved.rowCount ?? 0,
      viewer: { admin: ctx.role?.name === 'admin' }
    }
  }

  await db.update(mus.musArtists)
    .set({ name, sortName: sortNameFor(name), updatedAt: today })
    .where(eq(mus.musArtists.id, id))

  return { ok: true, merged: false, artistId: id }
})
