<script setup lang="ts">
/**
 * The music home.
 *
 * Fully anonymous: every list comes from the viewer-filtered home endpoint, so a
 * signed-out visitor sees the public catalogue and can start playing immediately.
 *
 * The layout is a hero (identity + the three things you can do from here) followed
 * by the catalogue rows; each row is a titled block with its own play action, so
 * the page reads as a set of shelves rather than one undifferentiated list.
 */
import type { MusicHome } from '../../composables/useMusic'
import { formatRuntime } from '../../composables/useMusic'

definePageMeta({ layout: 'music' })

const { t } = useI18n()
const { isLoggedIn } = useAuth()
const { playQueue } = useMusicPlayer()
const { openUpload } = useMusicUpload()

const { data, pending, error } = await useAsyncData('music:home', () => cGet<MusicHome>('/api/music/home'))

/** The hero's transport: whatever is newest, which is a sensible "start here". */
const heroTracks = computed(() => data.value?.recentlyAdded ?? [])
const hasLibrary = computed(() => (data.value?.stats.tracks ?? 0) > 0)

const stats = computed(() => {
  const value = data.value?.stats
  if (!value) return []
  return [
    { key: 'tracks', value: String(value.tracks), label: t('music.stats.tracks') },
    { key: 'albums', value: String(value.albums), label: t('music.stats.albums') },
    { key: 'artists', value: String(value.artists), label: t('music.stats.artists') },
    { key: 'duration', value: formatRuntime(value.duration), label: t('music.stats.duration') }
  ]
})

const trackRows = computed(() => {
  const home = data.value
  if (!home) return []
  return [
    {
      key: 'recentlyAdded',
      title: t('music.home.recentlyAdded'),
      tracks: home.recentlyAdded,
      to: '/music/tracks'
    },
    {
      key: 'recentlyPlayed',
      title: t('music.home.recentlyPlayed'),
      tracks: home.recentlyPlayed,
      to: null
    },
    {
      key: 'mostPlayed',
      title: t('music.home.mostPlayed'),
      tracks: home.mostPlayed,
      to: null
    }
  ].filter(row => row.tracks.length > 0)
})

const albumRows = computed(() => {
  const home = data.value
  if (!home) return []
  return [
    { key: 'recentAlbums', title: t('music.home.recentAlbums'), albums: home.recentAlbums, to: '/music/albums' },
    { key: 'randomAlbums', title: t('music.home.randomAlbums'), albums: home.randomAlbums, to: '/music/albums' }
  ].filter(row => row.albums.length > 0)
})

function shuffle(tracks: MusicHome['recentlyAdded']): void {
  playQueue([...tracks].sort(() => Math.random() - 0.5))
}
</script>

<template>
  <div class="space-y-12 sm:space-y-14">
    <!-- Hero -->
    <section
      class="relative overflow-hidden rounded-2xl border border-default bg-gradient-to-br from-primary/12 via-elevated/50 to-transparent p-6 sm:p-10"
    >
      <UIcon
        name="i-lucide-audio-lines"
        class="pointer-events-none absolute -right-8 -top-6 size-48 text-primary/5 sm:size-72"
      />

      <div class="relative max-w-3xl space-y-5">
        <p class="text-xs font-medium uppercase tracking-[0.2em] text-primary">
          {{ t('music.nav.home') }}
        </p>
        <h1 class="text-3xl font-semibold sm:text-4xl">
          {{ t('music.title') }}
        </h1>
        <p class="text-sm leading-relaxed text-muted sm:text-base">
          {{ t('music.home.lead') }}
        </p>

        <div class="flex flex-wrap items-center gap-2 pt-1">
          <UButton
            size="lg"
            icon="i-lucide-play"
            :label="t('music.actions.play')"
            :disabled="!heroTracks.length"
            @click="playQueue(heroTracks)"
          />
          <UButton
            size="lg"
            color="neutral"
            variant="subtle"
            icon="i-lucide-shuffle"
            :label="t('music.player.shuffle')"
            :disabled="!heroTracks.length"
            @click="shuffle(heroTracks)"
          />
          <UButton
            v-if="isLoggedIn"
            size="lg"
            color="neutral"
            variant="subtle"
            icon="i-lucide-upload"
            :label="t('music.actions.upload')"
            @click="openUpload"
          />
        </div>

        <dl
          v-if="stats.length"
          class="flex flex-wrap gap-x-10 gap-y-4 pt-3"
        >
          <div
            v-for="stat in stats"
            :key="stat.key"
          >
            <dt class="text-xs uppercase tracking-wide text-muted">
              {{ stat.label }}
            </dt>
            <dd class="text-2xl font-semibold tabular-nums">
              {{ stat.value }}
            </dd>
          </div>
        </dl>
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
      class="py-16 text-center text-sm text-muted"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-6 animate-spin"
      />
    </div>

    <template v-else-if="data">
      <!-- Empty catalogue -->
      <section
        v-if="!hasLibrary"
        class="rounded-2xl border border-dashed border-default px-6 py-16 text-center"
      >
        <UIcon
          name="i-lucide-music-4"
          class="mx-auto mb-4 size-10 text-muted"
        />
        <p class="text-sm text-muted">
          {{ t('music.empty.libraryHint') }}
        </p>
        <UButton
          v-if="isLoggedIn"
          class="mt-5"
          icon="i-lucide-upload"
          :label="t('music.actions.upload')"
          @click="openUpload"
        />
      </section>

      <!-- Track rows -->
      <section
        v-for="row in trackRows"
        :key="row.key"
        class="space-y-4"
      >
        <header class="flex items-end justify-between gap-4">
          <h2 class="text-xl font-semibold">
            {{ row.title }}
          </h2>
          <div class="flex items-center gap-1">
            <UButton
              icon="i-lucide-play"
              :label="t('music.actions.play')"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="playQueue(row.tracks)"
            />
            <UButton
              v-if="row.to"
              :to="row.to"
              :label="t('music.home.viewAll')"
              color="neutral"
              variant="ghost"
              size="xs"
              trailing-icon="i-lucide-arrow-right"
            />
          </div>
        </header>
        <MusicTrackList
          :tracks="row.tracks"
          :show-album="true"
          :show-cover="true"
        />
      </section>

      <!-- Album rows -->
      <section
        v-for="row in albumRows"
        :key="row.key"
        class="space-y-4"
      >
        <header class="flex items-end justify-between gap-4">
          <h2 class="text-xl font-semibold">
            {{ row.title }}
          </h2>
          <UButton
            :to="row.to"
            :label="t('music.home.viewAll')"
            color="neutral"
            variant="ghost"
            size="xs"
            trailing-icon="i-lucide-arrow-right"
          />
        </header>
        <div class="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          <MusicAlbumCard
            v-for="album in row.albums"
            :key="`${row.key}-${album.id}`"
            :album="album"
          />
        </div>
      </section>

      <!-- Playlists -->
      <section
        v-if="data.playlists.length"
        class="space-y-4"
      >
        <header class="flex items-end justify-between gap-4">
          <h2 class="text-xl font-semibold">
            {{ t('music.home.playlists') }}
          </h2>
          <UButton
            to="/music/playlists"
            :label="t('music.home.viewAll')"
            color="neutral"
            variant="ghost"
            size="xs"
            trailing-icon="i-lucide-arrow-right"
          />
        </header>
        <div class="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
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
            <p class="mt-3 truncate text-sm font-medium group-hover:text-primary">
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
