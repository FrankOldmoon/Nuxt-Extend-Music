/**
 * Music module — Nitro plugin.
 *
 * Runs once at server startup:
 *   1. declares the module's editable settings in the shared `configs` table;
 *   2. creates/upgrades the music tables (idempotent, safe on every boot);
 *   3. while music owns the site root, publishes the music sections into the
 *      host's header navigation (`site.navigation`).
 *
 * Deliberately *not* registered into the host's generic dashboard CRUD (which the
 * library module does): the module ships its own upload/edit UI, and mirroring
 * eight tables there would mean a second full table-metadata file for screens
 * nobody needs. Adding it later is a drop-in — `registerDrizzleSchema` plus
 * `registerDashboardTable` per table.
 */
import { db } from '../../../../server/database'
import { configs as configsTable } from '../../../../server/database/schema'
import { getConfigValue, upsertConfig } from '../../../../server/utils/configs'
import { runMusicMigrations } from '../database/migrate'

const MUSIC_ENABLED_KEY = 'music.enabled'
const SITE_NAV_KEY = 'site.navigation'
const LIBRARY_CLEAR_NAV_KEY = 'library.clearSiteNavigation'

/**
 * The sections published to the host header, in order.
 *
 * Labels come from this module's locale files (passed through the public runtime
 * config by `index.ts`) because the host renders `site.navigation` entries
 * verbatim — they are admin-authored content with no per-locale lookup. The
 * locale used is the site's default one, since the stored config is global.
 */
const SECTIONS: Array<{ key: string, url: string, icon: string }> = [
  { key: 'homeShort', url: '/', icon: 'i-lucide-house' },
  { key: 'tracks', url: '/music/tracks', icon: 'i-lucide-music' },
  { key: 'albums', url: '/music/albums', icon: 'i-lucide-disc-3' },
  { key: 'artists', url: '/music/artists', icon: 'i-lucide-user-round' },
  { key: 'genres', url: '/music/genres', icon: 'i-lucide-tags' },
  { key: 'playlists', url: '/music/playlists', icon: 'i-lucide-list-music' },
  { key: 'favorites', url: '/music/favorites', icon: 'i-lucide-star' },
  { key: 'search', url: '/music/search', icon: 'i-lucide-search' }
]

/** Resolve the section labels for the site's default locale. */
function resolveSections(): Array<{ label: string, url: string, icon: string, order: number }> {
  const runtime = useRuntimeConfig()
  const publicConfig = runtime.public as Record<string, unknown>
  const locale = String(publicConfig.musicNavLocale ?? 'en')
  const labels = (publicConfig.musicNavLabels ?? {}) as Record<string, Record<string, string>>
  const dictionary = labels[locale] ?? labels.en ?? {}

  return SECTIONS.map((section, index) => ({
    // Falls back to the key so a missing translation degrades to something
    // readable ("albums") instead of an empty menu entry.
    label: dictionary[section.key] ?? section.key,
    url: section.url,
    icon: section.icon,
    order: index
  }))
}

/**
 * Publish the music sections into the host's header navigation.
 *
 * Two things make this order-independent relative to the library module, which
 * empties the same config when *it* owns the root:
 *
 *   - music turns off that policy (`library.clearSiteNavigation = false`) —
 *     whose documented purpose is "clear the host navigation while the library
 *     owns the home page"; music now owns it, so the library should stand down.
 *     If the library's plugin ran first, it cleared the nav and music then fills
 *     it; if music ran first, the library reads the flag and skips. Either order
 *     ends with the music sections in place.
 *   - the sections are only written when the config is empty, so an admin who
 *     edits the navigation afterwards keeps their edits on the next boot.
 */
async function applyNavigationPolicy(): Promise<void> {
  try {
    const enabled = await getConfigValue<boolean>('music.siteNavigation', true).catch(() => true)
    if (!enabled) return

    // Stand the library's clear-policy down: it exists for the case this module
    // has just taken over.
    await upsertConfig({
      key: LIBRARY_CLEAR_NAV_KEY,
      value: 'false',
      type: 'boolean',
      description: 'Clear the host site.navigation while the library owns the home page'
    })

    const current = await getConfigValue<string>(SITE_NAV_KEY, '').catch(() => '')
    const isEmpty = !current || current === '[]' || current === '""'
    if (!isEmpty) {
      console.log(`[music] ${SITE_NAV_KEY} already configured — leaving it alone`)
      return
    }

    const items = resolveSections()
    await upsertConfig({
      key: SITE_NAV_KEY,
      value: JSON.stringify(items),
      type: 'json',
      description: 'Home page header navigation config (label/url/order/hidden)'
    })
    console.log(`[music] ${SITE_NAV_KEY} filled with ${items.length} music sections (${items[0]?.label ?? '?'} …)`)
  } catch (error) {
    console.warn('[music] navigation policy failed (ignored):', error)
  }
}

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

  // Only manage the header navigation while this module owns the site root.
  if (process.env.MUSIC_TAKE_SITE_ROOT !== 'false') {
    await applyNavigationPolicy()
  }
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
          key: 'music.siteNavigation',
          value: 'true',
          type: 'boolean',
          description: 'Publish the music sections into the host header navigation while music owns the home page'
        },
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
