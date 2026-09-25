<script setup lang="ts">
/**
 * Every track, with search and sorting.
 *
 * This is also the management surface (upload lives in the layout header; edit
 * and delete are per-row), so a signed-in user can run the whole catalogue from
 * one page.
 */
definePageMeta({ layout: 'music' })

const { t } = useI18n()
const { isLoggedIn } = useAuth()
const { playQueue } = useMusicPlayer()
const { openUpload } = useMusicUpload()

const term = ref('')
const debounced = ref('')
const sort = ref('created')
const page = ref(1)

let timer: ReturnType<typeof setTimeout> | undefined
watch(term, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    debounced.value = value.trim()
    page.value = 1
  }, 300)
})

const { data, pending, refresh } = await useAsyncData(
  'music:tracks',
  () => fetchTracks({
    q: debounced.value || undefined,
    sort: sort.value,
    page: page.value,
    pageSize: 100
  }),
  { watch: [debounced, sort, page] }
)

const sortItems = computed(() => [
  { label: t('music.browse.sortByRecent'), value: 'created' },
  { label: t('music.browse.sortByName'), value: 'title' },
  { label: t('music.browse.sortByPlays'), value: 'plays' },
  { label: t('music.track.duration'), value: 'duration' }
])

const totalPages = computed(() => {
  const total = data.value?.total ?? 0
  return Math.max(1, Math.ceil(total / (data.value?.pageSize || 100)))
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="mr-auto text-xl font-semibold">
        {{ t('music.nav.tracks') }}
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
      <UButton
        v-if="isLoggedIn"
        icon="i-lucide-upload"
        :label="t('music.actions.upload')"
        size="sm"
        @click="openUpload"
      />
      <UButton
        icon="i-lucide-play"
        :label="t('music.actions.play')"
        color="neutral"
        variant="subtle"
        size="sm"
        :disabled="!data?.items.length"
        @click="playQueue(data?.items ?? [])"
      />
    </div>

    <p class="text-xs text-muted">
      {{ data?.total ?? 0 }}
    </p>

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
      <MusicTrackList
        :tracks="data?.items ?? []"
        @changed="refresh"
      />

      <div
        v-if="totalPages > 1"
        class="flex items-center justify-center gap-2"
      >
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="page <= 1"
          @click="page -= 1"
        />
        <span class="text-xs text-muted">{{ page }} / {{ totalPages }}</span>
        <UButton
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="page >= totalPages"
          @click="page += 1"
        />
      </div>
    </template>
  </div>
</template>
