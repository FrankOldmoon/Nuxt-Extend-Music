/**
 * Music module — turning uploaded files into catalogue entries.
 *
 * One code path serves every entry point (upload, rescan), so tag extraction,
 * entity merging, cover inheritance and counter maintenance behave identically
 * wherever a file comes from.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { db } from '../../../../server/database'
import { getAbsolutePath } from '../../../../server/utils/fileStorage'
import * as mus from '../database/schema'
import { extractAudioMetadata } from './audioMeta'
import {
  ensureAlbum,
  ensureArtist,
  ensureGenre,
  refreshAlbumCounters,
  refreshArtistCounters,
  refreshGenreCounters
} from './catalogue'
import { hashBuffer, saveAudioFile, saveCoverImage } from './store'

/**
 * The host's `files` table requires an owner. Uploads always have one; a rescan
 * of a legacy track that was seeded without one falls back to the admin account.
 */
const FALLBACK_OWNER_ID = 1

export interface ImportOverrides {
  title?: string
  artist?: string
  albumArtist?: string
  album?: string
  genre?: string
  year?: number
  trackNo?: number
  discNo?: number
}

export interface ImportInput {
  buffer: Buffer
  filename: string
  userId: number | null
  isPublic: boolean
  /** Per-file overrides from the upload form; they win over the file's tags. */
  overrides?: ImportOverrides
  mimeType?: string
}

export interface ImportOutcome {
  trackId: number
  /** False when the same audio was already in the catalogue. */
  created: boolean
  duplicate: boolean
  title: string
  artistName: string | null
  albumName: string | null
}

/** Counters are refreshed from the entities a track actually points at. */
async function refreshForTrackIds(trackIds: number[]): Promise<void> {
  if (!trackIds.length) return
  const rows = await db
    .select({
      artistId: mus.musTracks.artistId,
      albumArtistId: mus.musTracks.albumArtistId,
      albumId: mus.musTracks.albumId,
      genreId: mus.musTracks.genreId
    })
    .from(mus.musTracks)
    .where(inArray(mus.musTracks.id, trackIds))

  await Promise.all([
    refreshArtistCounters(rows.flatMap(row => [row.artistId, row.albumArtistId])),
    refreshAlbumCounters(rows.map(row => row.albumId)),
    refreshGenreCounters(rows.map(row => row.genreId))
  ])
}

export { refreshForTrackIds as refreshCountersForTracks }

/**
 * Import one audio buffer.
 *
 * The content hash makes this idempotent: uploading the same file twice returns
 * the existing track instead of creating a twin, which also means the second
 * upload costs no storage.
 */
export async function importTrack(input: ImportInput): Promise<ImportOutcome> {
  const hash = hashBuffer(input.buffer)

  const existing = await db
    .select({ id: mus.musTracks.id, title: mus.musTracks.title })
    .from(mus.musTracks)
    .where(and(eq(mus.musTracks.hash, hash), isNull(mus.musTracks.deletedAt)))
    .limit(1)
  if (existing[0]) {
    return {
      trackId: existing[0].id,
      created: false,
      duplicate: true,
      title: existing[0].title,
      artistName: null,
      albumName: null
    }
  }

  const meta = extractAudioMetadata(input.buffer, input.filename)
  const overrides = input.overrides ?? {}

  const title = (overrides.title ?? meta.title ?? input.filename).trim() || input.filename
  const artistName = (overrides.artist ?? meta.artist)?.trim() || null
  const albumArtistName = (overrides.albumArtist ?? meta.albumArtist ?? meta.artist)?.trim() || null
  const albumName = (overrides.album ?? meta.album)?.trim() || null
  const genreName = (overrides.genre ?? meta.genre)?.trim() || null
  const year = overrides.year ?? meta.year

  const [artistId, albumArtistId, genreId] = await Promise.all([
    ensureArtist(artistName),
    ensureArtist(albumArtistName),
    ensureGenre(genreName)
  ])
  const albumId = await ensureAlbum(albumName, albumArtistId, year, meta.compilation)

  const saved = await saveAudioFile(input.buffer, input.filename)

  // Artwork: keep it on the track, and promote it to the album when the album
  // has none yet — that is what makes an album grid look right.
  let cover: string | null = null
  if (meta.picture && meta.picture.data.length) {
    cover = await saveCoverImage(input.userId ?? FALLBACK_OWNER_ID, meta.picture.data, meta.picture.mime)
  }
  if (cover && albumId) {
    const [album] = await db
      .select({ cover: mus.musAlbums.cover })
      .from(mus.musAlbums)
      .where(eq(mus.musAlbums.id, albumId))
      .limit(1)
    if (album && !album.cover) {
      await db.update(mus.musAlbums).set({ cover, updatedAt: new Date() }).where(eq(mus.musAlbums.id, albumId))
    }
  }

  const [inserted] = await db
    .insert(mus.musTracks)
    .values({
      title,
      artistId,
      albumArtistId,
      albumId,
      genreId,
      trackNo: overrides.trackNo ?? meta.trackNo ?? null,
      discNo: overrides.discNo ?? meta.discNo ?? null,
      year: year ?? null,
      duration: meta.duration,
      bitrate: meta.bitrate ?? null,
      sampleRate: meta.sampleRate ?? null,
      channels: meta.channels ?? null,
      format: meta.format,
      size: saved.size,
      hash: saved.hash,
      path: saved.path,
      originalName: input.filename,
      mimeType: input.mimeType ?? saved.mimeType,
      cover,
      lyrics: meta.lyrics ?? null,
      isPublic: input.isPublic,
      userId: input.userId
    })
    .returning({ id: mus.musTracks.id })

  const trackId = inserted!.id
  await refreshForTrackIds([trackId])

  return { trackId, created: true, duplicate: false, title, artistName, albumName }
}

/**
 * Re-read a track's tags from its file.
 *
 * Used by the admin rescan: after fixing tags in another tool, this is how the
 * catalogue catches up without re-uploading (and losing play counts and stars).
 */
export async function rescanTrack(trackId: number): Promise<{ ok: boolean, reason?: string }> {
  const [track] = await db
    .select()
    .from(mus.musTracks)
    .where(eq(mus.musTracks.id, trackId))
    .limit(1)
  if (!track) return { ok: false, reason: 'not found' }

  let buffer: Buffer
  try {
    buffer = await readFile(getAbsolutePath(track.path))
  } catch {
    return { ok: false, reason: 'file missing' }
  }

  const meta = extractAudioMetadata(buffer, track.originalName)
  const [artistId, albumArtistId, genreId] = await Promise.all([
    ensureArtist(meta.artist),
    ensureArtist(meta.albumArtist ?? meta.artist),
    ensureGenre(meta.genre)
  ])
  const albumId = await ensureAlbum(meta.album, albumArtistId, meta.year, meta.compilation)

  let cover = track.cover
  if (!cover && meta.picture && meta.picture.data.length) {
    cover = await saveCoverImage(track.userId ?? FALLBACK_OWNER_ID, meta.picture.data, meta.picture.mime)
  }

  await db.update(mus.musTracks)
    .set({
      title: meta.title || track.title,
      artistId,
      albumArtistId,
      albumId,
      genreId,
      trackNo: meta.trackNo ?? track.trackNo,
      discNo: meta.discNo ?? track.discNo,
      year: meta.year ?? track.year,
      duration: meta.duration || track.duration,
      bitrate: meta.bitrate ?? track.bitrate,
      sampleRate: meta.sampleRate ?? track.sampleRate,
      channels: meta.channels ?? track.channels,
      lyrics: meta.lyrics ?? track.lyrics,
      cover,
      updatedAt: new Date()
    })
    .where(eq(mus.musTracks.id, trackId))

  await refreshForTrackIds([trackId])
  return { ok: true }
}

/** Soft-delete a track and bring its entities' counters back up to date. */
export async function softDeleteTracks(trackIds: number[]): Promise<number> {
  if (!trackIds.length) return 0
  const now = new Date()
  const result = await db.update(mus.musTracks)
    .set({ deletedAt: now, updatedAt: now })
    .where(inArray(mus.musTracks.id, trackIds))
  await refreshForTrackIds(trackIds)
  return result.rowCount ?? 0
}

/** Restore soft-deleted tracks. */
export async function restoreTracks(trackIds: number[]): Promise<number> {
  if (!trackIds.length) return 0
  const now = new Date()
  const result = await db.update(mus.musTracks)
    .set({ deletedAt: null, updatedAt: now })
    .where(inArray(mus.musTracks.id, trackIds))
  await refreshForTrackIds(trackIds)
  return result.rowCount ?? 0
}
