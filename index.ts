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
 *   - serves its own pages under `/music/**` (provided by this layer).
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
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export default defineNuxtModule({
  meta: {
    name: 'music',
    configKey: 'music'
  },
  setup(_options, nuxt) {
    if (process.env.MUSIC_ENABLED !== 'true') return

    const takeRoot = process.env.MUSIC_TAKE_SITE_ROOT !== 'false'
    console.log(`[music] module entry active — pages under /music${takeRoot ? ', taking the site root' : ''}`)
    if (!takeRoot) return

    const resolver = createResolver(import.meta.url)
    const home = join(resolver.resolve('.'), 'app/pages/music/index.vue')
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
