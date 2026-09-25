<script setup lang="ts">
/**
 * An album in a grid: artwork, title, artist and the runtime summary.
 *
 * The hover overlay is a real play button — it fetches the album's tracks and
 * hands them to the player, so the grids on the home page are usable without a
 * detour through the album page. It sits inside a link, hence `.prevent`.
 */
import type { MusicAlbum, MusicTrack } from '../../composables/useMusic'
import { formatDuration } from '../../composables/useMusic'

defineProps<{ album: MusicAlbum }>()

const { t } = useI18n()
const { playQueue } = useMusicPlayer()

const loading = ref(false)

async function playAlbum(id: number): Promise<void> {
  if (loading.value) return
  loading.value = true
  try {
    const data = await cGet<{ tracks: MusicTrack[] }>(`/api/music/albums/${id}`)
    if (data.tracks.length) playQueue(data.tracks)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <NuxtLink
    :to="`/music/albums/${album.id}`"
    class="group block"
  >
    <div class="relative overflow-hidden rounded-xl shadow-sm transition-shadow group-hover:shadow-lg">
      <MusicCoverArt
        :src="album.coverUrl"
        :name="album.name"
        fill
        rounded="md"
        class="transition-transform duration-300 group-hover:scale-[1.03]"
      />
      <button
        type="button"
        class="absolute bottom-2 right-2 flex size-10 cursor-pointer items-center justify-center rounded-full bg-primary text-inverted opacity-0 shadow-lg transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        :title="t('music.actions.play')"
        @click.prevent.stop="playAlbum(album.id)"
      >
        <UIcon
          :name="loading ? 'i-lucide-loader-circle' : 'i-lucide-play'"
          :class="loading ? 'size-5 animate-spin' : 'size-5'"
        />
      </button>
    </div>

    <div class="mt-3 space-y-1">
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
        <span v-if="album.year">{{ album.year }} · </span>{{ album.trackCount }} · {{ formatDuration(album.duration) }}
      </p>
    </div>
  </NuxtLink>
</template>
