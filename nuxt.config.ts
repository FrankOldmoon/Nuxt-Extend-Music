/**
 * Music module (Nuxt layer) — i18n locale files and public runtime config.
 *
 * The i18n block tells @nuxtjs/i18n to load this layer's locale files
 * (`./i18n/locales/*.json`) and deep-merge them with the host locales, so the
 * music tables/fields participate in the shared `dashboard.tables` /
 * `dashboard.fields` translation system and the music UI is localised.
 */
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      /**
       * Where ffmpeg.wasm is fetched from when a user converts a track.
       *
       * Nothing is bundled: conversion is a browser-side, on-demand download, so
       * this can point at a self-hosted copy for offline or intranet installs
       * (override with `NUXT_PUBLIC_MUSIC_FFMPEG_BASE`).
       */
      musicFfmpegBase: 'https://unpkg.com',
      /**
       * Filled in by `index.ts` at build time: the header-navigation labels read
       * from this module's locale files, plus the site's default locale to pick
       * them with. The host renders those labels verbatim, so they have to be
       * plain text chosen up front.
       */
      musicNavLocale: 'en',
      musicNavLabels: {} as Record<string, Record<string, string>>
    }
  },
  i18n: {
    langDir: 'locales',
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'zh', name: '中文', file: 'zh.json' },
      { code: 'zh-TW', name: '繁體中文', file: 'zh-TW.json' }
    ]
  }
})
