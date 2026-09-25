/**
 * Music — one track, with its lyrics resolved.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as mus from '../../../database/schema'
import { getViewer, hydrateTracks, trackQuery, trackVisibility } from '../../../utils/catalogue'
import { readSidecarLyrics } from '../../../utils/lyrics'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid track id' })
  }

  const viewer = await getViewer(event)
  const [row] = await trackQuery()
    .where(and(eq(mus.musTracks.id, id), trackVisibility(viewer)))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Track not found' })

  const [dto] = await hydrateTracks([row], viewer)

  // Embedded lyrics win; a sidecar `.lrc` next to the audio is the fallback.
  const [full] = await db
    .select({ lyrics: mus.musTracks.lyrics, path: mus.musTracks.path })
    .from(mus.musTracks)
    .where(and(eq(mus.musTracks.id, id), isNull(mus.musTracks.deletedAt)))
    .limit(1)

  const lyrics = full?.lyrics ?? (await readSidecarLyrics(full?.path ?? ''))

  return { track: dto, lyrics }
})
