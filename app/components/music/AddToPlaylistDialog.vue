<script setup lang="ts">
/**
 * Add one track to a playlist, or create a playlist around it.
 */
import type { MusicPlaylist, MusicTrack } from '../../composables/useMusic'

const props = defineProps<{ track: MusicTrack }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const toast = useToast()

const playlists = ref<MusicPlaylist[]>([])
const chosen = ref<number | null>(null)
const newName = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const data = await cGet<{ items: MusicPlaylist[] }>('/api/music/playlists')
    // Only playlists the viewer may actually write to are offered.
    playlists.value = data.items.filter(item => item.canEdit)
    chosen.value = playlists.value[0]?.id ?? null
  } catch (cause) {
    error.value = extractErrorMessage(cause)
  }
})

async function add(): Promise<void> {
  if (chosen.value == null) return
  busy.value = true
  try {
    await cPost(`/api/music/playlists/${chosen.value}/tracks`, {
      action: 'add',
      trackIds: [props.track.id]
    })
    toast.add({ title: t('music.messages.addedToPlaylist'), color: 'success' })
    emit('close')
  } catch (cause) {
    error.value = extractErrorMessage(cause)
  } finally {
    busy.value = false
  }
}

async function createAndAdd(): Promise<void> {
  const name = newName.value.trim()
  if (!name) return
  busy.value = true
  try {
    await cPost('/api/music/playlists', { name, trackIds: [props.track.id] })
    toast.add({ title: t('music.messages.addedToPlaylist'), color: 'success' })
    emit('close')
  } catch (cause) {
    error.value = extractErrorMessage(cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UModal
    :open="true"
    :title="t('music.actions.addToPlaylist')"
    @update:open="emit('close')"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          :description="error"
        />

        <p class="text-sm text-muted">
          {{ track.title }}
        </p>

        <div
          v-if="playlists.length"
          class="space-y-2"
        >
          <label
            v-for="playlist in playlists"
            :key="playlist.id"
            class="flex cursor-pointer items-center gap-2 text-sm"
          >
            <input
              v-model="chosen"
              type="radio"
              :value="playlist.id"
              class="accent-primary"
            >
            <span class="flex-1 truncate">{{ playlist.name }}</span>
            <span class="text-xs text-muted">{{ t('music.playlists.trackCount', { count: playlist.trackCount }) }}</span>
          </label>
        </div>
        <p
          v-else
          class="text-sm text-muted"
        >
          {{ t('music.playlists.empty') }}
        </p>

        <div class="flex items-end gap-2 border-t border-default pt-4">
          <UFormField
            :label="t('music.playlists.new')"
            class="flex-1"
          >
            <UInput
              v-model="newName"
              :placeholder="t('music.playlists.namePlaceholder')"
              size="sm"
            />
          </UFormField>
          <UButton
            :label="t('music.playlists.create')"
            color="neutral"
            variant="subtle"
            size="sm"
            :disabled="!newName.trim() || busy"
            @click="createAndAdd"
          />
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          :label="t('music.actions.cancel')"
          color="neutral"
          variant="ghost"
          @click="emit('close')"
        />
        <UButton
          :label="t('music.actions.save')"
          :disabled="chosen == null || busy"
          :loading="busy"
          @click="add"
        />
      </div>
    </template>
  </UModal>
</template>
