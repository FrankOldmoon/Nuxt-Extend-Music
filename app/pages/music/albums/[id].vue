<script setup lang="ts">
/**
 * One album: its artwork, the runtime summary, and its track list in disc/track
 * order (the API sorts it, so a two-disc album reads correctly).
 */
import type { MusicAlbum, MusicTrack } from '../../../composables/useMusic'
import { formatDuration } from '../../../composables/useMusic'

definePageMeta({ layout: 'music' })

const route = useRoute()
const { t } = useI18n()
const { playQueue } = useMusicPlayer()

const id = Number(route.params.id)

const { data, pending, error, refresh } = await useAsyncData(
  `music:album:${id}`,
  () => cGet<{ album: MusicAlbum, tracks: MusicTrack[] }>(`/api/music/albums/${id}`)
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
      <div class="flex flex-col gap-5 sm:flex-row">
        <MusicCoverArt
          :src="data.album.coverUrl"
          :name="data.album.name"
          size="lg"
          class="sm:size-48"
        />
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <p class="text-xs uppercase tracking-wide text-muted">
            {{ t('music.nav.albums') }}
          </p>
          <h1 class="text-2xl font-semibold">
            {{ data.album.name }}
          </h1>
          <p class="text-sm text-muted">
            <NuxtLink
              v-if="data.album.artistId"
              :to="`/music/artists/${data.album.artistId}`"
              class="hover:text-primary hover:underline"
            >
              {{ data.album.artistName ?? t('music.track.unknownArtist') }}
            </NuxtLink>
            <span v-else>{{ t('music.track.unknownArtist') }}</span>
            <span v-if="data.album.year"> · {{ data.album.year }}</span>
            <span> · {{ data.album.trackCount }} · {{ formatDuration(data.album.duration) }}</span>
          </p>
          <div class="mt-1 flex flex-wrap gap-2">
            <UButton
              icon="i-lucide-play"
              :label="t('music.actions.play')"
              :disabled="!data.tracks.length"
              @click="playQueue(data.tracks)"
            />
            <UButton
              icon="i-lucide-shuffle"
              :label="t('music.player.shuffle')"
              color="neutral"
              variant="subtle"
              :disabled="!data.tracks.length"
              @click="playQueue([...data.tracks].sort(() => Math.random() - 0.5))"
            />
          </div>
        </div>
      </div>

      <MusicTrackList
        :tracks="data.tracks"
        :show-album="false"
        @changed="refresh"
      />
    </template>
  </div>
</template>
