/**
 * Music module (Nuxt layer + module entry).
 *
 * A private, Navidrome-style music library that mounts onto the host admin
 * project. It is independent from the library module: they may be enabled
 * together.
 *
 * While `MUSIC_ENABLED=true` the module:
 *   - takes over the site root: the host landing page (`/`) is removed and
 *     replaced with the music home (mirrors the library module);
 *   - serves its own pages under `/music/**` (provided by this layer);
 *   - publishes its sections into the host header navigation, and hands the
 *     labels to the Nitro plugin through the public runtime config (see below).
 *
 * Set `MUSIC_TAKE_SITE_ROOT=false` to leave `/` to the host — or to the library
 * module, which claims the root in exactly the same way.
 *
 * The takeover runs on `pages:resolved` rather than `pages:extend` so that it has
 * the last word: the host mounts its `modules/*` layers in filesystem order, so
 * if this module and the library both claimed the root from `pages:extend`, which
 * one won would depend on directory listing order. `pages:resolved` runs after
 * every `pages:extend` hook, so "music enabled ⇒ music is the home" is
 * deterministic rather than accidental.
 */
import { defineNuxtModule, createResolver } from '@nuxt/kit'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LOCALE_FILES = [['en', 'en.json'], ['zh', 'zh.json'], ['zh-TW', 'zh-TW.json']] as const

/**
 * Read the header-navigation labels out of this module's own locale files.
 *
 * The host renders `site.navigation` entries verbatim — they are admin-authored
 * content with no per-locale lookup — so the music sections have to be stored as
 * plain text. Reading the strings here (build time, where the files are on disk)
 * and passing them through the public runtime config avoids duplicating them,
 * and lets the header speak the site's default language instead of whichever
 * language happened to be hardcoded.
 */
function readNavLabels(moduleDir: string): Record<string, Record<string, string>> | null {
  try {
    const labels: Record<string, Record<string, string>> = {}
    for (const [code, file] of LOCALE_FILES) {
      const raw = readFileSync(join(moduleDir, 'i18n', 'locales', file), 'utf8')
      const parsed = JSON.parse(raw) as { music?: { nav?: Record<string, string> } }
      labels[code] = parsed.music?.nav ?? {}
    }
    return labels
  } catch (error) {
    console.warn('[music] could not read locale files for the header navigation:', error)
    return null
  }
}

export default defineNuxtModule({
  meta: {
    name: 'music',
    configKey: 'music'
  },
  setup(_options, nuxt) {
    if (process.env.MUSIC_ENABLED !== 'true') return

    const resolver = createResolver(import.meta.url)
    const moduleDir = resolver.resolve('.')

    // Header-navigation labels, in the site's default language (the config that
    // drives the header is global, so "the default locale" is the only choice
    // that is right for most visitors).
    const publicConfig = nuxt.options.runtimeConfig.public as Record<string, unknown>
    const labels = readNavLabels(moduleDir)
    if (labels) publicConfig.musicNavLabels = labels
    const i18n = (nuxt.options as { i18n?: { defaultLocale?: string } }).i18n
    publicConfig.musicNavLocale = i18n?.defaultLocale ?? 'en'

    const takeRoot = process.env.MUSIC_TAKE_SITE_ROOT !== 'false'
    console.log(`[music] module entry active — pages under /music${takeRoot ? ', taking the site root' : ''}`)
    if (!takeRoot) return

    const home = join(moduleDir, 'app/pages/music/index.vue')
    if (!existsSync(home)) {
      // Guard rather than crash the build: taking the root needs the page to exist.
      console.warn(`[music] ${home} is missing — leaving the site root alone`)
      return
    }

    nuxt.hook('pages:resolved', (pages) => {
      // Drop whatever currently owns `/` (the host landing page, or another
      // module's home) and mount the music home there instead.
      for (let i = pages.length - 1; i >= 0; i--) {
        if (pages[i]?.path === '/') pages.splice(i, 1)
      }
      pages.unshift({ name: 'music-home', path: '/', file: home })
    })
  }
})
