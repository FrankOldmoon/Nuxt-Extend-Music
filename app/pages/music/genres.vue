<script setup lang="ts">
/**
 * Genres: pick one on the left, see its tracks on the right.
 *
 * A single page rather than an index plus a detail route — genres are a flat
 * filter list, and a two-click drill-down for them adds navigation without
 * adding information.
 */
import type { MusicGenre, MusicTrack } from '../../composables/useMusic'

definePageMeta({ layout: 'music' })

const { t } = useI18n()
const { playQueue } = useMusicPlayer()

const selected = ref<number | null>(null)

const { data: genres, pending: loadingGenres } = await useAsyncData(
  'music:genres',
  () => cGet<{ items: MusicGenre[] }>('/api/music/genres', { sort: 'tracks' })
)

watchEffect(() => {
  if (selected.value == null && genres.value?.items.length) {
    selected.value = genres.value.items[0]!.id
  }
})

const { data: detail, pending: loadingTracks, refresh } = await useAsyncData(
  'music:genre:tracks',
  () => (selected.value == null
    ? Promise.resolve(null)
    : cGet<{ genre: MusicGenre, tracks: MusicTrack[] }>(`/api/music/genres/${selected.value}`)),
  { watch: [selected] }
)
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-semibold">
      {{ t('music.nav.genres') }}
    </h1>

    <div
      v-if="loadingGenres"
      class="py-10 text-center text-sm text-muted"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin"
      />
    </div>

    <p
      v-else-if="!genres?.items.length"
      class="py-10 text-center text-sm text-muted"
    >
      {{ t('music.empty.noGenres') }}
    </p>

    <div
      v-else
      class="flex flex-col gap-4 lg:flex-row"
    >
      <div class="flex flex-wrap gap-1 lg:w-56 lg:shrink-0 lg:flex-col lg:flex-nowrap lg:overflow-y-auto">
        <UButton
          v-for="genre in genres.items"
          :key="genre.id"
          :label="`${genre.name} · ${genre.trackCount}`"
          :color="selected === genre.id ? 'primary' : 'neutral'"
          :variant="selected === genre.id ? 'soft' : 'ghost'"
          size="sm"
          class="justify-start"
          @click="selected = genre.id"
        />
      </div>

      <div class="min-w-0 flex-1 space-y-3">
        <div
          v-if="loadingTracks"
          class="py-10 text-center text-sm text-muted"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-5 animate-spin"
          />
        </div>

        <template v-else-if="detail">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-medium">
              {{ detail.genre.name }}
            </h2>
            <UButton
              icon="i-lucide-play"
              :label="t('music.actions.play')"
              color="neutral"
              variant="ghost"
              size="xs"
              :disabled="!detail.tracks.length"
              @click="playQueue(detail.tracks)"
            />
          </div>
          <MusicTrackList
            :tracks="detail.tracks"
            @changed="refresh"
          />
        </template>
      </div>
    </div>
  </div>
</template>
