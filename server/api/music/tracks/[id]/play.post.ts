/**
 * Music — record a play.
 *
 * Deliberately open to anonymous listeners (public tracks only): the play log is
 * what fills "recently played" and the play counters, and a visitor who can play
 * the music should contribute to it. Promoted to a play count once enough of the
 * track has actually been heard, so skipping past a song does not count.
 */
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../../../../../../server/database'
import * as mus from '../../../../database/schema'
import { getViewer, trackVisibility } from '../../../../utils/catalogue'

/** Three quarters of the track (or 30 s for very long ones) counts as a play. */
function countsAsPlay(msPlayed: number, durationSeconds: number): boolean {
  if (!durationSeconds) return msPlayed > 30_000
  return msPlayed >= Math.min(durationSeconds * 1000 * 0.75, 240_000)
}

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid track id' })
  }

  const body = await readBody<{ msPlayed?: number }>(event).catch(() => ({ msPlayed: 0 }))
  const msPlayed = Math.max(0, Math.min(Number(body?.msPlayed ?? 0) || 0, 24 * 60 * 60 * 1000))

  const viewer = await getViewer(event)
  const [track] = await db
    .select({ id: mus.musTracks.id, duration: mus.musTracks.duration, albumId: mus.musTracks.albumId })
    .from(mus.musTracks)
    .where(and(eq(mus.musTracks.id, id), trackVisibility(viewer)))
    .limit(1)
  if (!track) throw createError({ statusCode: 404, statusMessage: 'Track not found' })

  await db.insert(mus.musPlayHistory).values({
    trackId: track.id,
    userId: viewer.userId,
    msPlayed
  })

  const counted = countsAsPlay(msPlayed, track.duration)
  if (counted) {
    await db.update(mus.musTracks)
      .set({ playCount: sql`${mus.musTracks.playCount} + 1`, lastPlayedAt: new Date() })
      .where(eq(mus.musTracks.id, track.id))
    // Album play count is a display aggregate, kept loosely in step.
    if (track.albumId) {
      await db.update(mus.musAlbums)
        .set({ playCount: sql`${mus.musAlbums.playCount} + 1` })
        .where(eq(mus.musAlbums.id, track.albumId))
    }
  }

  return { ok: true, counted }
})
