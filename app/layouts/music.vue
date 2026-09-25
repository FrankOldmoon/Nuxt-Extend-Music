<script setup lang="ts">
/**
 * The music shell: section nav, page slot, and the transport bar pinned to the
 * bottom with its queue/lyrics panels above it.
 *
 * A layout (rather than a component each page imports) is what lets the player
 * keep running while pages come and go.
 */
const { t } = useI18n()
const route = useRoute()
const { isLoggedIn } = useAuth()
const { current, queue } = useMusicPlayer()

const panel = ref<'none' | 'queue' | 'lyrics'>('none')
const uploadOpen = ref(false)

const navItems = computed(() => [
  { to: '/music', label: t('music.nav.home'), icon: 'i-lucide-house' },
  { to: '/music/tracks', label: t('music.nav.tracks'), icon: 'i-lucide-music' },
  { to: '/music/albums', label: t('music.nav.albums'), icon: 'i-lucide-disc-3' },
  { to: '/music/artists', label: t('music.nav.artists'), icon: 'i-lucide-user-round' },
  { to: '/music/genres', label: t('music.nav.genres'), icon: 'i-lucide-tags' },
  { to: '/music/playlists', label: t('music.nav.playlists'), icon: 'i-lucide-list-music' },
  { to: '/music/favorites', label: t('music.nav.favorites'), icon: 'i-lucide-star' },
  { to: '/music/search', label: t('music.nav.search'), icon: 'i-lucide-search' }
])

function isActive(to: string): boolean {
  return to === '/music' ? route.path === '/music' || route.path === '/' : route.path.startsWith(to)
}

function togglePanel(value: 'queue' | 'lyrics'): void {
  panel.value = panel.value === value ? 'none' : value
}

// An emptied queue has nothing to panel over.
watch(() => queue.value.length, (length) => {
  if (!length) panel.value = 'none'
})

function onUploaded(): void {
  // Pages hold their data in useAsyncData; a global refresh picks up the new tracks.
  void refreshNuxtData()
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-default">
    <header class="sticky top-0 z-30 border-b border-default bg-default/95 backdrop-blur">
      <div class="mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-2 sm:px-4">
        <NuxtLink
          to="/music"
          class="flex shrink-0 items-center gap-2 font-semibold"
        >
          <UIcon
            name="i-lucide-audio-lines"
            class="size-5 text-primary"
          />
          <span class="hidden sm:inline">{{ t('music.title') }}</span>
        </NuxtLink>

        <nav class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <UButton
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            :label="item.label"
            :icon="item.icon"
            :color="isActive(item.to) ? 'primary' : 'neutral'"
            :variant="isActive(item.to) ? 'soft' : 'ghost'"
            size="sm"
            class="shrink-0"
          />
        </nav>

        <UButton
          v-if="isLoggedIn"
          icon="i-lucide-upload"
          :label="t('music.actions.upload')"
          size="sm"
          class="shrink-0"
          @click="uploadOpen = true"
        />
        <UButton
          v-else
          to="/login"
          icon="i-lucide-log-in"
          :label="t('music.messages.notSignedIn')"
          color="neutral"
          variant="subtle"
          size="sm"
          class="shrink-0"
        />
      </div>
    </header>

    <main class="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-4">
      <slot />
    </main>

    <div class="sticky bottom-0 z-20">
      <MusicQueuePanel
        v-if="current && panel === 'queue'"
        @close="panel = 'none'"
      />
      <MusicLyricsPane v-else-if="current && panel === 'lyrics'" />
      <MusicPlayerBar
        v-if="current"
        :panel="panel"
        @toggle-panel="togglePanel"
      />
    </div>

    <MusicUploadDialog
      v-if="uploadOpen"
      @close="uploadOpen = false"
      @uploaded="onUploaded"
    />
  </div>
</template>
