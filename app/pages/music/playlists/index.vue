<script setup lang="ts">
/**
 * Playlists: the viewer's own plus every shared one.
 *
 * Public playlists are listed for anonymous visitors too — that is the point of
 * a shared playlist — while create/edit/delete appear only where the API will
 * actually accept them (`playlist.canEdit`).
 */
import type { MusicPlaylist } from '../../composables/useMusic'
import { formatDuration } from '../../composables/useMusic'

definePageMeta({ layout: 'music' })

const { t } = useI18n()
const { isLoggedIn } = useAuth()
const toast = useToast()

const { data, pending, refresh } = await useAsyncData(
  'music:playlists',
  () => cGet<{ items: MusicPlaylist[], total: number }>('/api/music/playlists')
)

const creating = ref(false)
const draftName = ref('')
const draftPublic = ref(true)
const busy = ref(false)

async function create(): Promise<void> {
  const name = draftName.value.trim()
  if (!name) return
  busy.value = true
  try {
    await cPost('/api/music/playlists', { name, isPublic: draftPublic.value })
    toast.add({ title: t('music.messages.saved'), color: 'success' })
    creating.value = false
    draftName.value = ''
    refresh()
  } catch (error) {
    toast.add({ title: extractErrorMessage(error), color: 'error' })
  } finally {
    busy.value = false
  }
}

async function remove(playlist: MusicPlaylist): Promise<void> {
  if (!window.confirm(t('music.messages.confirmDelete'))) return
  try {
    await cDelete(`/api/music/playlists/${playlist.id}`)
    toast.add({ title: t('music.messages.deleted'), color: 'success' })
    refresh()
  } catch (error) {
    toast.add({ title: extractErrorMessage(error), color: 'error' })
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <h1 class="mr-auto text-xl font-semibold">
        {{ t('music.nav.playlists') }}
      </h1>
      <UButton
        v-if="isLoggedIn"
        icon="i-lucide-plus"
        :label="t('music.playlists.new')"
        size="sm"
        @click="creating = true"
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

    <p
      v-else-if="!data?.items.length"
      class="py-10 text-center text-sm text-muted"
    >
      {{ t('music.playlists.empty') }}
    </p>

    <div
      v-else
      class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
    >
      <div
        v-for="playlist in data.items"
        :key="playlist.id"
        class="group"
      >
        <NuxtLink
          :to="`/music/playlists/${playlist.id}`"
          class="block"
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
            <UBadge
              v-if="!playlist.isPublic"
              color="neutral"
              variant="subtle"
              size="sm"
              class="mr-1"
            >
              {{ t('music.visibility.private') }}
            </UBadge>
            {{ t('music.playlists.trackCount', { count: playlist.trackCount }) }}
            <span v-if="playlist.duration"> · {{ formatDuration(playlist.duration) }}</span>
          </p>
        </NuxtLink>
        <UButton
          v-if="playlist.canEdit"
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="xs"
          class="mt-1 opacity-0 group-hover:opacity-100"
          :title="t('music.actions.delete')"
          @click="remove(playlist)"
        />
      </div>
    </div>

    <UModal
      :open="creating"
      :title="t('music.playlists.new')"
      @update:open="creating = false"
    >
      <template #body>
        <div class="space-y-3">
          <UFormField
            :label="t('music.playlists.name')"
            required
          >
            <UInput
              v-model="draftName"
              :placeholder="t('music.playlists.namePlaceholder')"
              @keyup.enter="create"
            />
          </UFormField>
          <UFormField :label="t('music.playlists.isPublic')">
            <USwitch v-model="draftPublic" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            :label="t('music.actions.cancel')"
            color="neutral"
            variant="ghost"
            @click="creating = false"
          />
          <UButton
            :label="t('music.playlists.create')"
            :disabled="!draftName.trim()"
            :loading="busy"
            @click="create"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
