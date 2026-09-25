<script setup lang="ts">
/**
 * Artists, as a grid of circular portraits with their catalogue size.
 */
definePageMeta({ layout: 'music' })

const { t } = useI18n()
const term = ref('')
const debounced = ref('')
const sort = ref('name')

let timer: ReturnType<typeof setTimeout> | undefined
watch(term, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    debounced.value = value.trim()
  }, 300)
})

const { data, pending } = await useAsyncData(
  'music:artists',
  () => fetchArtists({ q: debounced.value || undefined, sort: sort.value, pageSize: 200 }),
  { watch: [debounced, sort] }
)

const sortItems = computed(() => [
  { label: t('music.browse.sortByName'), value: 'name' },
  { label: t('music.browse.sortByTracks'), value: 'tracks' },
  { label: t('music.browse.sortByPlays'), value: 'plays' }
])
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="mr-auto text-xl font-semibold">
        {{ t('music.nav.artists') }}
      </h1>
      <UInput
        v-model="term"
        icon="i-lucide-search"
        :placeholder="t('music.search.placeholder')"
        size="sm"
        class="w-56"
      />
      <USelect
        v-model="sort"
        :items="sortItems"
        size="sm"
        class="w-36"
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

    <div
      v-else-if="data?.items.length"
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
    >
      <NuxtLink
        v-for="artist in data.items"
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
        <p class="w-full truncate text-xs text-muted">
          {{ artist.albumCount }} · {{ artist.trackCount }}
        </p>
      </NuxtLink>
    </div>

    <p
      v-else
      class="py-10 text-center text-sm text-muted"
    >
      {{ t('music.empty.noArtists') }}
    </p>
  </div>
</template>
