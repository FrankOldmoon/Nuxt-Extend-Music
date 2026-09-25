/**
 * Music — stream a track.
 *
 * Range requests are honoured (a browser that cannot issue one has to download
 * the whole file before it will let you seek). Public tracks stream without a
 * session, which is what makes the landing page playable for anonymous
 * visitors; private tracks require the owner or an admin.
 *
 * Only the file as stored is served: format conversion happens in the browser
 * (see `app/composables/useAudioTranscode.ts`), so this endpoint never needs an
 * ffmpeg binary on the server.
 */
import { and, eq, isNull } from 'drizzle-orm'
import { createReadStream } from 'node:fs'
import { db } from '../../../../../../../server/database'
import { getAbsolutePath } from '../../../../../../../server/utils/fileStorage'
import * as mus from '../../../../database/schema'
import { canEditTrack, getViewer } from '../../../../utils/catalogue'
import { contentRangeHeader, parseRangeHeader, rangeLength } from '../../../../utils/stream'

export default defineEventHandler(async (event) => {
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
  if (!track.isPublic && !canEditTrack(viewer, track)) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found' })
  }

  const absolutePath = getAbsolutePath(track.path)
  const mimeType = track.mimeType || 'audio/mpeg'
  const size = track.size

  // Accept-Ranges is what tells the browser it may seek at all.
  setResponseHeader(event, 'Accept-Ranges', 'bytes')
  setResponseHeader(event, 'Content-Type', mimeType)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=3600')

  // Best-effort "last touched" marker; the play counter is driven by the play
  // endpoint, which knows how much was actually heard.
  void db.update(mus.musTracks)
    .set({ lastPlayedAt: new Date() })
    .where(eq(mus.musTracks.id, track.id))
    .catch(() => {})

  const range = parseRangeHeader(getRequestHeader(event, 'range'), size)
  if (!range) {
    setResponseHeader(event, 'Content-Length', size)
    return sendStream(event, createReadStream(absolutePath))
  }

  setResponseStatus(event, 206)
  setResponseHeader(event, 'Content-Range', contentRangeHeader(range, size))
  setResponseHeader(event, 'Content-Length', rangeLength(range))
  return sendStream(event, createReadStream(absolutePath, { start: range.start, end: range.end }))
})
