<script setup lang="ts">
/**
 * The music shell.
 *
 * The site chrome is the host's own (`AppHeader`), which is what puts the music
 * sections in the header navigation: they are published to `site.navigation` by
 * this module's Nitro plugin, and the header renders that config — so there is
 * one navigation, editable in the dashboard, instead of a second row owned by
 * this layout. The only thing added here is the transport bar pinned to the
 * bottom, with its queue and lyric panels above it.
 *
 * A layout (rather than a component each page imports) is what lets the player
 * keep running while pages come and go.
 */
const { current, queue } = useMusicPlayer()
const { open: uploadOpen, closeUpload } = useMusicUpload()

const panel = ref<'none' | 'queue' | 'lyrics'>('none')

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
    <AppHeader />

    <UMain>
      <!--
        Generous, responsive gutters: the catalogue is dense (cover grids, long
        track lists) and flush edges made it feel cramped. The extra bottom
        padding keeps the fixed transport bar from covering the last row.
      -->
      <div
        class="mx-auto w-full max-w-[1600px] px-5 py-8 sm:px-8 lg:px-12"
        :class="current ? 'pb-32' : 'pb-12'"
      >
        <slot />
      </div>
    </UMain>

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
      @close="closeUpload"
      @uploaded="onUploaded"
    />
  </div>
</template>
