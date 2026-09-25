/**
 * Music module — Nitro plugin.
 *
 * Runs once at server startup:
 *   1. declares the module's editable settings in the shared `configs` table;
 *   2. creates/upgrades the music tables (idempotent, safe on every boot).
 *
 * Deliberately *not* registered into the host's generic dashboard CRUD (which the
 * library module does): the module ships its own upload/edit UI, and mirroring
 * eight tables there would mean a second full table-metadata file for screens
 * nobody needs. Adding it later is a drop-in — `registerDrizzleSchema` plus
 * `registerDashboardTable` per table.
 */
import { db } from '../../../../server/database'
import { configs as configsTable } from '../../../../server/database/schema'
import { getConfigValue } from '../../../../server/utils/configs'
import { runMusicMigrations } from '../database/migrate'

const MUSIC_ENABLED_KEY = 'music.enabled'

export default defineNitroPlugin(async () => {
  // The layer is only mounted when MUSIC_ENABLED=true, so this records the same
  // switch in the database where an admin can flip it without a redeploy.
  const enabled = await getConfigValue(MUSIC_ENABLED_KEY, true).catch(() => true)
  if (!enabled) {
    console.log('[music] disabled via config (music.enabled=false) — skipping setup')
    return
  }

  console.log('[music] initializing music module')
  await ensureConfigs()
  await runMusicMigrations()
})

/** Declare the module's settings (idempotent — an admin's edits win). */
async function ensureConfigs(): Promise<void> {
  try {
    await db
      .insert(configsTable)
      .values([
        { key: MUSIC_ENABLED_KEY, value: 'true', type: 'boolean', description: 'Enable the music module' },
        { key: 'music.maxFileSizeMB', value: '100', type: 'number', description: 'Max upload size per audio file (MB)' },
        {
          key: 'music.ffmpegBase',
          value: 'https://unpkg.com',
          type: 'string',
          description: 'Where the browser fetches ffmpeg.wasm from when converting a track (self-host for offline installs)'
        }
      ])
      .onConflictDoNothing({ target: configsTable.key })
  } catch (error) {
    console.warn('[music] config ensure failed (ignored):', error)
  }
}
