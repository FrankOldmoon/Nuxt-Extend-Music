/**
 * Music — update a track's metadata.
 *
 * Only the fields present in the payload are written. Renaming an artist or an
 * album re-resolves the entity, so fixing a typo merges the track into the
 * existing artist instead of leaving a duplicate behind.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import { requireUser } from '../../../../../../server/utils/auth'
import * as mus from '../../../database/schema'
import {
  canEditTrack,
  ensureAlbum,
  ensureArtist,
  ensureGenre,
  getViewer,
  hydrateTracks,
  trackQuery
} from '../../../utils/catalogue'
import { refreshCountersForTracks } from '../../../utils/import'

export default defineEventHandler(async (event) => {
  const ctx = await requireUser(event)
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
    throw createError({ statusCode: 403, statusMessage: 'You cannot modify this track' })
  }

  const body = await readBody<{
    title?: string
    artist?: string | null
    albumArtist?: string | null
    album?: string | null
    genre?: string | null
    year?: number | null
    trackNo?: number | null
    discNo?: number | null
    isPublic?: boolean
    lyrics?: string | null
  }>(event)

  const sets: Partial<typeof mus.musTracks.$inferInsert> = {}

  if ('title' in body) {
    const title = String(body.title ?? '').trim()
    if (!title) throw createError({ statusCode: 400, statusMessage: 'title cannot be empty' })
    sets.title = title.slice(0, 500)
  }
  if ('isPublic' in body) sets.isPublic = Boolean(body.isPublic)
  if ('year' in body) sets.year = Number.isFinite(Number(body.year)) ? Number(body.year) : null
  if ('trackNo' in body) sets.trackNo = Number.isFinite(Number(body.trackNo)) ? Number(body.trackNo) : null
  if ('discNo' in body) sets.discNo = Number.isFinite(Number(body.discNo)) ? Number(body.discNo) : null
  if ('lyrics' in body) {
    const lyrics = String(body.lyrics ?? '').trim()
    sets.lyrics = lyrics ? lyrics.slice(0, 100000) : null
  }

  // Entity re-resolution: only when the caller actually sent those fields.
  if ('artist' in body) sets.artistId = await ensureArtist(body.artist)
  if ('albumArtist' in body || 'artist' in body) {
    sets.albumArtistId = await ensureArtist(body.albumArtist ?? body.artist ?? track.originalName)
  }
  if ('genre' in body) sets.genreId = await ensureGenre(body.genre)
  if ('album' in body || 'year' in body || 'albumArtist' in body) {
    const albumName = 'album' in body
      ? String(body.album ?? '').trim()
      : (await db.select({ name: mus.musAlbums.name }).from(mus.musAlbums)
          .where(eq(mus.musAlbums.id, track.albumId ?? 0)).limit(1))[0]?.name ?? ''
    sets.albumId = await ensureAlbum(
      albumName,
      sets.albumArtistId ?? track.albumArtistId,
      'year' in body ? Number(body.year) || null : track.year
    )
  }

  if (Object.keys(sets).length) {
    sets.updatedAt = new Date()
    await db.update(mus.musTracks).set(sets).where(eq(mus.musTracks.id, id))
  }

  // Counters follow the old *and* the new entities.
  await refreshCountersForTracks([id, track.id])

  const [row] = await trackQuery().where(eq(mus.musTracks.id, id)).limit(1)
  const [dto] = row ? await hydrateTracks([row], { userId: ctx.user.id, admin: true }) : []
  return { track: dto ?? null }
})
