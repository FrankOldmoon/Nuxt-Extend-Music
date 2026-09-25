<script setup lang="ts">
/**
 * Starred tracks, albums and artists.
 *
 * Stars belong to a user, so this is the one page that genuinely needs a session
 * — and it says so plainly instead of failing.
 */
import type { MusicAlbum, MusicArtist, MusicTrack } from '../../composables/useMusic'

definePageMeta({ layout: 'music' })

const { t } = useI18n()
const { isLoggedIn } = useAuth()

const type = ref<'track' | 'album' | 'artist'>('track')

interface StarsPayload {
  counts: Record<string, number>
  items: Array<MusicTrack | MusicAlbum | MusicArtist>
  total: number
  signedIn: boolean
}

const { data, pending, refresh } = await useAsyncData(
  'music:stars',
  () => cGet<StarsPayload>('/api/music/stars', { type: type.value, pageSize: 200 }),
  { watch: [type] }
)

const tabs = computed(() => [
  { value: 'track' as const, label: t('music.favorites.tracks'), count: data.value?.counts.track ?? 0 },
  { value: 'album' as const, label: t('music.favorites.albums'), count: data.value?.counts.album ?? 0 },
  { value: 'artist' as const, label: t('music.favorites.artists'), count: data.value?.counts.artist ?? 0 }
])

const tracks = computed(() => (type.value === 'track' ? data.value?.items as MusicTrack[] ?? [] : []))
const albums = computed(() => (type.value === 'album' ? data.value?.items as MusicAlbum[] ?? [] : []))
const artists = computed(() => (type.value === 'artist' ? data.value?.items as MusicArtist[] ?? [] : []))
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-semibold">
      {{ t('music.favorites.title') }}
    </h1>

    <div
      v-if="!isLoggedIn"
      class="rounded-lg border border-dashed border-default p-10 text-center"
    >
      <UIcon
        name="i-lucide-star"
        class="mx-auto mb-3 size-8 text-muted"
      />
      <p class="text-sm text-muted">
        {{ t('music.favorites.signInHint') }}
      </p>
      <UButton
        to="/login"
        icon="i-lucide-log-in"
        :label="t('music.messages.notSignedIn')"
        class="mt-3"
      />
    </div>

    <template v-else>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="tab in tabs"
          :key="tab.value"
          :label="`${tab.label} · ${tab.count}`"
          :color="type === tab.value ? 'primary' : 'neutral'"
          :variant="type === tab.value ? 'soft' : 'ghost'"
          size="sm"
          @click="type = tab.value"
        />
      </div>

      <div
        v-if="pending"
        class="py-10 text-center text-sm text-muted"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-5 animate-spin"
        />
      </div>

      <template v-else>
        <p
          v-if="!data?.items.length"
          class="py-10 text-center text-sm text-muted"
        >
          {{ t('music.favorites.empty') }}
        </p>

        <MusicTrackList
          v-else-if="type === 'track'"
          :tracks="tracks"
          @changed="refresh"
        />

        <div
          v-else-if="type === 'album'"
          class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
        >
          <MusicAlbumCard
            v-for="album in albums"
            :key="album.id"
            :album="album"
          />
        </div>

        <div
          v-else
          class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
        >
          <NuxtLink
            v-for="artist in artists"
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
      </template>
    </template>
  </div>
</template>
