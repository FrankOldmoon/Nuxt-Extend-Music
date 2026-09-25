<script setup lang="ts">
/**
 * One search box over tracks, albums and artists.
 *
 * Matching happens in SQL (`ilike` on titles plus an `exists` on the joined
 * artist/album names), so it stays correct for CJK titles without a tokeniser.
 */
import type { MusicAlbum, MusicArtist, MusicTrack } from '../../composables/useMusic'

definePageMeta({ layout: 'music' })

const { t } = useI18n()
const { playQueue } = useMusicPlayer()

const term = ref('')
const debounced = ref('')

let timer: ReturnType<typeof setTimeout> | undefined
watch(term, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    debounced.value = value.trim()
  }, 300)
})

interface SearchPayload {
  term: string
  tracks: MusicTrack[]
  albums: MusicAlbum[]
  artists: MusicArtist[]
  total: number
}

const { data, pending, refresh } = await useAsyncData(
  'music:search',
  () => cGet<SearchPayload>('/api/music/search', { q: debounced.value || undefined, limit: 40 }),
  { watch: [debounced] }
)

const hasResults = computed(() => !!data.value && (data.value.tracks.length || data.value.albums.length || data.value.artists.length))
</script>

<template>
  <div class="space-y-5">
    <h1 class="text-xl font-semibold">
      {{ t('music.nav.search') }}
    </h1>

    <UInput
      v-model="term"
      icon="i-lucide-search"
      size="lg"
      autofocus
      :placeholder="t('music.search.placeholder')"
      class="max-w-xl"
    />

    <p
      v-if="!debounced"
      class="py-10 text-center text-sm text-muted"
    >
      {{ t('music.search.empty') }}
    </p>

    <div
      v-else-if="pending"
      class="py-10 text-center text-sm text-muted"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin"
      />
    </div>

    <p
      v-else-if="!hasResults"
      class="py-10 text-center text-sm text-muted"
    >
      {{ t('music.empty.noResults') }}
    </p>

    <template v-else-if="data">
      <section
        v-if="data.artists.length"
        class="space-y-3"
      >
        <h2 class="text-lg font-medium">
          {{ t('music.search.artists') }}
        </h2>
        <div class="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          <NuxtLink
            v-for="artist in data.artists"
            :key="artist.id"
            :to="`/music/artists/${artist.id}`"
            class="group flex flex-col items-center text-center"
          >
            <MusicCoverArt
              :src="artist.coverUrl"
              :name="artist.name"
              fill
              rounded="full"
            />
            <p class="mt-2 w-full truncate text-sm font-medium group-hover:text-primary">
              {{ artist.name }}
            </p>
          </NuxtLink>
        </div>
      </section>

      <section
        v-if="data.albums.length"
        class="space-y-3"
      >
        <h2 class="text-lg font-medium">
          {{ t('music.search.albums') }}
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          <MusicAlbumCard
            v-for="album in data.albums"
            :key="album.id"
            :album="album"
          />
        </div>
      </section>

      <section
        v-if="data.tracks.length"
        class="space-y-3"
      >
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-medium">
            {{ t('music.search.tracks') }}
          </h2>
          <UButton
            icon="i-lucide-play"
            :label="t('music.actions.play')"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="playQueue(data.tracks)"
          />
        </div>
        <MusicTrackList
          :tracks="data.tracks"
          @changed="refresh"
        />
      </section>
    </template>
  </div>
</template>
