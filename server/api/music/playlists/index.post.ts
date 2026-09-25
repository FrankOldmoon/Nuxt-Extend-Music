/**
 * Music — create a playlist, optionally seeded with tracks.
 */
import { requireUser } from '../../../../../../server/utils/auth'
import { getViewer } from '../../../utils/catalogue'
import { addTracksToPlaylist, createPlaylist } from '../../../utils/playlists'

export default defineEventHandler(async (event) => {
  const ctx = await requireUser(event)
  const body = await readBody<{
    name?: string
    description?: string | null
    isPublic?: boolean
    trackIds?: unknown[]
  }>(event)

  const name = String(body?.name ?? '').trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'name is required' })

  const playlistId = await createPlaylist({
    name: name.slice(0, 300),
    description: body?.description ? String(body.description).slice(0, 2000) : null,
    isPublic: body?.isPublic === undefined ? true : Boolean(body.isPublic),
    userId: ctx.user.id
  })

  const trackIds = (Array.isArray(body?.trackIds) ? body.trackIds : [])
    .map(Number)
    .filter((id: number) => Number.isInteger(id) && id > 0)

  let added = 0
  if (trackIds.length) {
    const viewer = await getViewer(event)
    added = await addTracksToPlaylist(playlistId, trackIds, viewer)
  }

  return { ok: true, playlistId, added }
})
