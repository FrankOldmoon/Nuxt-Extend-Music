/**
 * Music — list playlists the viewer may see (their own, plus every public one).
 */
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../../../../../server/database'
import * as mus from '../../../database/schema'
import { coverUrl, getViewer } from '../../../utils/catalogue'

export default defineEventHandler(async (event) => {
  const viewer = await getViewer(event)

  const scope = viewer.admin
    ? sql`true`
    : viewer.userId == null
      ? eq(mus.musPlaylists.isPublic, true)
      : or(eq(mus.musPlaylists.isPublic, true), eq(mus.musPlaylists.userId, viewer.userId))!

  const rows = await db
    .select({
      id: mus.musPlaylists.id,
      name: mus.musPlaylists.name,
      description: mus.musPlaylists.description,
      cover: mus.musPlaylists.cover,
      isPublic: mus.musPlaylists.isPublic,
      userId: mus.musPlaylists.userId,
      trackCount: mus.musPlaylists.trackCount,
      duration: mus.musPlaylists.duration,
      updatedAt: mus.musPlaylists.updatedAt
    })
    .from(mus.musPlaylists)
    .where(and(isNull(mus.musPlaylists.deletedAt), scope))
    .orderBy(desc(mus.musPlaylists.updatedAt), asc(mus.musPlaylists.name))

  return {
    items: rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      coverUrl: coverUrl(row.cover),
      isPublic: row.isPublic,
      trackCount: row.trackCount,
      duration: row.duration,
      updatedAt: row.updatedAt,
      canEdit: viewer.admin || (viewer.userId != null && row.userId === viewer.userId),
      mine: viewer.userId != null && row.userId === viewer.userId
    })),
    total: rows.length,
    signedIn: viewer.userId != null
  }
})
