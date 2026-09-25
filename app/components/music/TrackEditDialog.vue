<script setup lang="ts">
/**
 * Edit one track's metadata, visibility and lyrics.
 *
 * Changing the artist, album or genre re-resolves (and can merge) those entities
 * server-side, so a typo fixed here also fixes the artist page it appeared on.
 */
import type { MusicTrack } from '../../composables/useMusic'

const props = defineProps<{ track: MusicTrack }>()
const emit = defineEmits<{ close: [], saved: [] }>()

const { t } = useI18n()
const toast = useToast()

const form = reactive({
  title: props.track.title,
  artist: props.track.artistName ?? '',
  albumArtist: props.track.albumArtistName ?? '',
  album: props.track.albumName ?? '',
  genre: props.track.genreName ?? '',
  year: props.track.year ? String(props.track.year) : '',
  trackNo: props.track.trackNo ? String(props.track.trackNo) : '',
  discNo: props.track.discNo ? String(props.track.discNo) : '',
  isPublic: props.track.isPublic,
  lyrics: ''
})

const saving = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  // Lyrics are not part of the list payload; fetch them for this one track.
  try {
    const data = await cGet<{ lyrics: string | null }>(`/api/music/tracks/${props.track.id}`)
    form.lyrics = data.lyrics ?? ''
  } catch {
    /* lyrics are optional — the rest of the form still works */
  }
})

function toNumber(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

async function save(): Promise<void> {
  if (!form.title.trim()) return
  saving.value = true
  error.value = null
  try {
    await cPut(`/api/music/tracks/${props.track.id}`, {
      title: form.title.trim(),
      artist: form.artist.trim() || null,
      albumArtist: form.albumArtist.trim() || null,
      album: form.album.trim() || null,
      genre: form.genre.trim() || null,
      year: toNumber(form.year),
      trackNo: toNumber(form.trackNo),
      discNo: toNumber(form.discNo),
      isPublic: form.isPublic,
      lyrics: form.lyrics
    })
    toast.add({ title: t('music.messages.saved'), color: 'success' })
    emit('saved')
    emit('close')
  } catch (cause) {
    error.value = extractErrorMessage(cause)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="true"
    :title="t('music.edit.title')"
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

        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField
            :label="t('music.track.title')"
            required
            class="sm:col-span-2"
          >
            <UInput
              v-model="form.title"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('music.track.artist')">
            <UInput
              v-model="form.artist"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('music.track.albumArtist')">
            <UInput
              v-model="form.albumArtist"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('music.track.album')">
            <UInput
              v-model="form.album"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('music.track.genre')">
            <UInput
              v-model="form.genre"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('music.track.year')">
            <UInput
              v-model="form.year"
              type="number"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('music.track.trackNo')">
            <UInput
              v-model="form.trackNo"
              type="number"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="t('music.track.discNo')">
            <UInput
              v-model="form.discNo"
              type="number"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="t('music.edit.isPublic')"
            class="sm:col-span-2"
          >
            <USwitch v-model="form.isPublic" />
          </UFormField>
        </div>

        <UFormField
          :label="t('music.edit.lyrics')"
          :hint="t('music.edit.lyricsHint')"
        >
          <UTextarea
            v-model="form.lyrics"
            :rows="6"
            class="w-full font-mono text-xs"
          />
        </UFormField>
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
          :loading="saving"
          :disabled="!form.title.trim()"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
