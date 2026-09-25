<script setup lang="ts">
/**
 * Albums, as a grid.
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
  'music:albums',
  () => fetchAlbums({ q: debounced.value || undefined, sort: sort.value, pageSize: 200 }),
  { watch: [debounced, sort] }
)

const sortItems = computed(() => [
  { label: t('music.browse.sortByName'), value: 'name' },
  { label: t('music.browse.sortByRecent'), value: 'recent' },
  { label: t('music.browse.sortByPlays'), value: 'plays' }
])
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="mr-auto text-xl font-semibold">
        {{ t('music.nav.albums') }}
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
      <MusicAlbumCard
        v-for="album in data.items"
        :key="album.id"
        :album="album"
      />
    </div>

    <p
      v-else
      class="py-10 text-center text-sm text-muted"
    >
      {{ t('music.empty.noAlbums') }}
    </p>
  </div>
</template>
