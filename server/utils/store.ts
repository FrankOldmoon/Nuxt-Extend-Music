/**
 * Music module — storage helpers.
 *
 * Audio files live in the host project's `storage/` directory and are reached
 * only through this module's own authenticated endpoint (they must NOT be
 * reachable through the host's public `/api/files/serve` route — the library of
 * a private instance is private).
 *
 * Cover art is additionally registered in the host `files` table so the host's
 * generic image plumbing can render it, exactly like the library module does.
 */
import { eq } from 'drizzle-orm'
import { db } from '../../../../server/database'
import { files as hostFiles } from '../../../../server/database/schema'
import { buildStoragePath, calculateHash, saveToStorage } from '../../../../server/utils/fileStorage'
import { audioMimeType } from './audioMeta'

export interface SavedAudio {
  path: string
  size: number
  hash: string
  mimeType: string
}

export function hashBuffer(buffer: Buffer): string {
  return calculateHash(buffer)
}

/** Persist an audio file; the hash-based path makes re-uploads idempotent. */
export async function saveAudioFile(buffer: Buffer, originalName: string): Promise<SavedAudio> {
  const hash = calculateHash(buffer)
  const path = await buildStoragePath(originalName, hash)
  await saveToStorage(buffer, path)
  return {
    path,
    size: buffer.length,
    hash,
    mimeType: audioMimeType(originalName) ?? 'application/octet-stream'
  }
}

const COVER_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp'
}

export function isCoverMime(mime: string | undefined): boolean {
  return !!mime && mime in COVER_MIME
}

/**
 * Persist cover art and register it as a host file. Deduplicated across the whole
 * `files` table by content hash, so an album whose every track carries the same
 * embedded JPEG only stores it once.
 *
 * `userId` must be a real user because the host's `files` table requires one —
 * callers fall back to the acting user when a legacy track has no owner.
 */
export async function saveCoverImage(userId: number, buffer: Buffer, mime: string): Promise<string | null> {
  if (!buffer.length || !isCoverMime(mime)) return null
  const hash = calculateHash(buffer)

  try {
    const existing = await db
      .select({ path: hostFiles.path })
      .from(hostFiles)
      .where(eq(hostFiles.hash, hash))
      .limit(1)
    if (existing[0]) return existing[0].path
  } catch {
    /* fall through and store a fresh copy */
  }

  const extension = COVER_MIME[mime] ?? 'jpg'
  const path = await buildStoragePath(`cover.${extension}`, hash)
  await saveToStorage(buffer, path)

  try {
    await db.insert(hostFiles).values({
      userId,
      filename: path.split('/').pop() ?? `cover.${extension}`,
      originalName: `cover.${extension}`,
      hash,
      mimeType: mime,
      size: buffer.length,
      path,
      storage: 'local'
    })
  } catch {
    // Unique-violation race: the same image was registered concurrently, and the
    // bytes already live at this hash-derived path.
  }

  return path
}
