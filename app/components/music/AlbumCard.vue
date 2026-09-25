<script setup lang="ts">
/**
 * An album in a grid: artwork, title, artist and the runtime summary.
 */
import type { MusicAlbum } from '../../composables/useMusic'
import { formatDuration } from '../../composables/useMusic'

defineProps<{ album: MusicAlbum }>()
const { t } = useI18n()
</script>

<template>
  <NuxtLink
    :to="`/music/albums/${album.id}`"
    class="group block"
  >
    <MusicCoverArt
      :src="album.coverUrl"
      :name="album.name"
      fill
    />
    <div class="mt-2 space-y-0.5">
      <p
        class="truncate text-sm font-medium group-hover:text-primary"
        :title="album.name"
      >
        {{ album.name }}
      </p>
      <p class="truncate text-xs text-muted">
        {{ album.artistName ?? t('music.track.unknownArtist') }}
      </p>
      <p class="truncate text-xs text-muted">
        {{ album.year ? `${album.year} · ` : '' }}{{ album.trackCount }} · {{ formatDuration(album.duration) }}
      </p>
    </div>
  </NuxtLink>
</template>
