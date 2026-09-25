<script setup lang="ts">
/**
 * One playlist: play it, edit its name/visibility, or remove tracks from it.
 */
import type { MusicPlaylist, MusicTrack } from '../../../composables/useMusic'
import { formatDuration } from '../../../composables/useMusic'

definePageMeta({ layout: 'music' })

const route = useRoute()
const { t } = useI18n()
const toast = useToast()
const { playQueue } = useMusicPlayer()

const id = Number(route.params.id)

const { data, pending, error, refresh } = await useAsyncData(
  `music:playlist:${id}`,
  () => cGet<{ playlist: MusicPlaylist, tracks: MusicTrack[] }>(`/api/music/playlists/${id}`)
)

const renaming = ref(false)
const draft = reactive({ name: '', isPublic: true })
const busy = ref(false)

function openRename(): void {
  if (!data.value) return
  draft.name = data.value.playlist.name
  draft.isPublic = data.value.playlist.isPublic
  renaming.value = true
}

async function save(): Promise<void> {
  const name = draft.name.trim()
  if (!name) return
  busy.value = true
  try {
    await cPut(`/api/music/playlists/${id}`, { name, isPublic: draft.isPublic })
    toast.add({ title: t('music.messages.saved'), color: 'success' })
    renaming.value = false
    refresh()
  } catch (cause) {
    toast.add({ title: extractErrorMessage(cause), color: 'error' })
  } finally {
    busy.value = false
  }
}
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
          :src="data.playlist.coverUrl"
          :name="data.playlist.name"
          size="lg"
          class="sm:size-48"
        />
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <p class="text-xs uppercase tracking-wide text-muted">
            {{ t('music.nav.playlists') }}
          </p>
          <h1 class="text-2xl font-semibold">
            {{ data.playlist.name }}
          </h1>
          <p
            v-if="data.playlist.description"
            class="text-sm text-muted"
          >
            {{ data.playlist.description }}
          </p>
          <p class="text-sm text-muted">
            {{ t('music.playlists.trackCount', { count: data.playlist.trackCount }) }}
            <span v-if="data.playlist.duration"> · {{ formatDuration(data.playlist.duration) }}</span>
            <UBadge
              v-if="!data.playlist.isPublic"
              color="neutral"
              variant="subtle"
              size="sm"
              class="ml-1"
            >
              {{ t('music.visibility.private') }}
            </UBadge>
          </p>
          <div class="mt-1 flex flex-wrap gap-2">
            <UButton
              icon="i-lucide-play"
              :label="t('music.actions.play')"
              :disabled="!data.tracks.length"
              @click="playQueue(data.tracks)"
            />
            <UButton
              v-if="data.playlist.canEdit"
              icon="i-lucide-pencil"
              :label="t('music.actions.edit')"
              color="neutral"
              variant="subtle"
              @click="openRename"
            />
          </div>
        </div>
      </div>

      <p
        v-if="!data.tracks.length"
        class="py-10 text-center text-sm text-muted"
      >
        {{ t('music.playlists.noTracks') }}
      </p>
      <MusicTrackList
        v-else
        :tracks="data.tracks"
        :playlist-id="id"
        @changed="refresh"
      />
    </template>

    <UModal
      :open="renaming"
      :title="t('music.actions.edit')"
      @update:open="renaming = false"
    >
      <template #body>
        <div class="space-y-3">
          <UFormField
            :label="t('music.playlists.name')"
            required
          >
            <UInput
              v-model="draft.name"
              @keyup.enter="save"
            />
          </UFormField>
          <UFormField :label="t('music.playlists.isPublic')">
            <USwitch v-model="draft.isPublic" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            :label="t('music.actions.cancel')"
            color="neutral"
            variant="ghost"
            @click="renaming = false"
          />
          <UButton
            :label="t('music.actions.save')"
            :loading="busy"
            :disabled="!draft.name.trim()"
            @click="save"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
