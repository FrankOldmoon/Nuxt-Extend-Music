<script setup lang="ts">
/**
 * The music home.
 *
 * Fully anonymous: every list comes from the viewer-filtered home endpoint, so a
 * signed-out visitor sees the public catalogue and can start playing immediately.
 * The upload entry point appears only for signed-in users (see the layout).
 */
import type { MusicHome } from '../../composables/useMusic'
import { formatRuntime } from '../../composables/useMusic'

definePageMeta({ layout: 'music' })

const { t } = useI18n()
const { playQueue } = useMusicPlayer()

const { data, pending, error } = await useAsyncData('music:home', () => cGet<MusicHome>('/api/music/home'))

const sections = computed(() => {
  const home = data.value
  if (!home) return []
  return [
    { key: 'recentlyAdded', title: t('music.home.recentlyAdded'), tracks: home.recentlyAdded },
    { key: 'recentlyPlayed', title: t('music.home.recentlyPlayed'), tracks: home.recentlyPlayed },
    { key: 'mostPlayed', title: t('music.home.mostPlayed'), tracks: home.mostPlayed }
  ].filter(section => section.tracks.length > 0)
})

const albumSections = computed(() => {
  const home = data.value
  if (!home) return []
  return [
    { key: 'recentAlbums', title: t('music.home.recentAlbums'), albums: home.recentAlbums },
    { key: 'randomAlbums', title: t('music.home.randomAlbums'), albums: home.randomAlbums }
  ].filter(section => section.albums.length > 0)
})

function playSection(tracks: MusicHome['recentlyAdded']): void {
  playQueue(tracks)
}
</script>

<template>
  <div class="space-y-8">
    <section>
      <h1 class="text-2xl font-semibold">
        {{ t('music.title') }}
      </h1>
      <p class="mt-1 text-sm text-muted">
        {{ t('music.home.lead') }}
      </p>

      <div
        v-if="data"
        class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted"
      >
        <span><strong class="text-highlighted">{{ data.stats.tracks }}</strong> {{ t('music.stats.tracks') }}</span>
        <span><strong class="text-highlighted">{{ data.stats.albums }}</strong> {{ t('music.stats.albums') }}</span>
        <span><strong class="text-highlighted">{{ data.stats.artists }}</strong> {{ t('music.stats.artists') }}</span>
        <span><strong class="text-highlighted">{{ data.stats.genres }}</strong> {{ t('music.stats.genres') }}</span>
        <span v-if="data.stats.duration">
          {{ t('music.stats.duration') }} <strong class="text-highlighted">{{ formatRuntime(data.stats.duration) }}</strong>
        </span>
      </div>
    </section>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      :description="t('music.messages.loadFailed')"
    />

    <div
      v-else-if="pending"
      class="py-10 text-center text-sm text-muted"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin"
      />
    </div>

    <template v-else-if="data">
      <section
        v-if="!data.stats.tracks"
        class="rounded-lg border border-dashed border-default p-10 text-center"
      >
        <UIcon
          name="i-lucide-music-4"
          class="mx-auto mb-3 size-8 text-muted"
        />
        <p class="text-sm text-muted">
          {{ t('music.empty.libraryHint') }}
        </p>
      </section>

      <section
        v-for="section in sections"
        :key="section.key"
        class="space-y-2"
      >
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-medium">
            {{ section.title }}
          </h2>
          <UButton
            icon="i-lucide-play"
            :label="t('music.actions.play')"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="playSection(section.tracks)"
          />
        </div>
        <MusicTrackList
          :tracks="section.tracks"
          :show-album="true"
          :show-cover="true"
        />
      </section>

      <section
        v-for="section in albumSections"
        :key="section.key"
        class="space-y-3"
      >
        <h2 class="text-lg font-medium">
          {{ section.title }}
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          <MusicAlbumCard
            v-for="album in section.albums"
            :key="`${section.key}-${album.id}`"
            :album="album"
          />
        </div>
      </section>

      <section
        v-if="data.playlists.length"
        class="space-y-3"
      >
        <h2 class="text-lg font-medium">
          {{ t('music.home.playlists') }}
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          <NuxtLink
            v-for="playlist in data.playlists"
            :key="playlist.id"
            :to="`/music/playlists/${playlist.id}`"
            class="group block"
          >
            <MusicCoverArt
              :src="playlist.coverUrl"
              :name="playlist.name"
              fill
            />
            <p class="mt-2 truncate text-sm font-medium group-hover:text-primary">
              {{ playlist.name }}
            </p>
            <p class="truncate text-xs text-muted">
              {{ t('music.playlists.trackCount', { count: playlist.trackCount }) }}
            </p>
          </NuxtLink>
        </div>
      </section>
    </template>
  </div>
</template>
