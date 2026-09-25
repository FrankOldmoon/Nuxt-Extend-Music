/**
 * Music — upload audio files.
 *
 * Multipart `files` parts; every file is imported through the shared pipeline so
 * tags, entity merging and artwork behave exactly like a rescan. Requires a
 * session (only browsing is anonymous), and each file may carry per-file
 * overrides from the upload form.
 *
 * The response reports per-file outcomes rather than failing the whole batch:
 * one unreadable file should not discard the other nineteen.
 */
import { requireUser } from '../../../../../../server/utils/auth'
import { getConfigValue } from '../../../../../../server/utils/configs'
import { getViewer } from '../../../utils/catalogue'
import { isSupportedAudio } from '../../../utils/audioMeta'
import { importTrack, type ImportOverrides } from '../../../utils/import'

export default defineEventHandler(async (event) => {
  const ctx = await requireUser(event)
  const form = await readMultipartFormData(event)
  if (!form) throw createError({ statusCode: 400, statusMessage: 'No multipart body' })

  const fileParts = form.filter(part => part.name === 'files' && part.filename)
  if (!fileParts.length) throw createError({ statusCode: 400, statusMessage: 'No files found in request' })

  const field = (name: string): string => {
    const part = form.find(candidate => candidate.name === name && !candidate.filename)
    return part ? part.data.toString('utf8').trim() : ''
  }

  // Batch-wide defaults, overridable per file via `<name>[<index>]` fields.
  const defaults: ImportOverrides = {}
  const genre = field('genre')
  if (genre) defaults.genre = genre
  const album = field('album')
  if (album) defaults.album = album
  const artist = field('artist')
  if (artist) defaults.artist = artist

  const isPublicRaw = field('isPublic')
  const isPublic = isPublicRaw === '' ? true : isPublicRaw === 'true' || isPublicRaw === '1'

  const maxMB = await getConfigValue<number>('music.maxFileSizeMB', 100).catch(() => 100)
  const maxBytes = Math.max(0, Number(maxMB)) * 1024 * 1024

  const viewer = await getViewer(event)
  const results: Array<Record<string, unknown>> = []

  for (const [index, part] of fileParts.entries()) {
    const filename = part.filename!
    if (!isSupportedAudio(filename)) {
      results.push({ filename, ok: false, reason: 'unsupported format' })
      continue
    }
    if (maxBytes > 0 && part.data.length > maxBytes) {
      results.push({ filename, ok: false, reason: `exceeds ${maxMB} MB` })
      continue
    }

    const overrides: ImportOverrides = { ...defaults }
    const title = field(`title[${index}]`)
    if (title) overrides.title = title
    const fileTrackNo = field(`trackNo[${index}]`)
    if (fileTrackNo) overrides.trackNo = Number.parseInt(fileTrackNo, 10) || undefined

    try {
      const outcome = await importTrack({
        buffer: part.data,
        filename,
        userId: ctx.user.id,
        isPublic,
        overrides
      })
      results.push({ filename, ok: true, ...outcome })
    } catch (error) {
      results.push({
        filename,
        ok: false,
        reason: error instanceof Error ? error.message : 'import failed'
      })
    }
  }

  return {
    results,
    imported: results.filter(row => row.ok && row.created).length,
    duplicates: results.filter(row => row.duplicate).length,
    failed: results.filter(row => !row.ok).length,
    viewer: { signedIn: viewer.userId != null }
  }
})
