<script setup lang="ts">
/**
 * One artist: their albums, then every track of theirs that the viewer may see.
 */
import type { MusicAlbum, MusicArtist, MusicTrack } from '../../../composables/useMusic'

definePageMeta({ layout: 'music' })

const route = useRoute()
const { t } = useI18n()
const { playQueue } = useMusicPlayer()

const id = Number(route.params.id)

const { data, pending, error, refresh } = await useAsyncData(
  `music:artist:${id}`,
  () => cGet<{ artist: MusicArtist, albums: MusicAlbum[], tracks: MusicTrack[] }>(`/api/music/artists/${id}`)
)
</script>

<template>
  <div class="space-y-6">
    <div
      v-if="pending"
      class="py-10 text-center text-sm text-muted"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin"
      />
    </div>

    <UAlert
      v-else-if="error || !data"
      color="error"
      variant="subtle"
      :description="t('music.messages.notFound')"
    />

    <template v-else>
      <div class="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <MusicCoverArt
          :src="data.artist.coverUrl"
          :name="data.artist.name"
          size="lg"
          rounded="full"
          class="size-32"
        />
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <p class="text-xs uppercase tracking-wide text-muted">
            {{ t('music.nav.artists') }}
          </p>
          <h1 class="text-2xl font-semibold">
            {{ data.artist.name }}
          </h1>
          <p class="text-sm text-muted">
            {{ data.artist.albumCount }} · {{ data.artist.trackCount }}
          </p>
          <div class="flex flex-wrap justify-center gap-2 sm:justify-start">
            <UButton
              icon="i-lucide-play"
              :label="t('music.actions.play')"
              :disabled="!data.tracks.length"
              @click="playQueue(data.tracks)"
            />
          </div>
        </div>
      </div>

      <section
        v-if="data.albums.length"
        class="space-y-3"
      >
        <h2 class="text-lg font-medium">
          {{ t('music.nav.albums') }}
        </h2>
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          <MusicAlbumCard
            v-for="album in data.albums"
            :key="album.id"
            :album="album"
          />
        </div>
      </section>

      <section class="space-y-3">
        <h2 class="text-lg font-medium">
          {{ t('music.nav.tracks') }}
        </h2>
        <MusicTrackList
          :tracks="data.tracks"
          :show-album="true"
          @changed="refresh"
        />
      </section>
    </template>
  </div>
</template>
