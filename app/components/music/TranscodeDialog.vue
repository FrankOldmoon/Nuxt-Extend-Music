<script setup lang="ts">
/**
 * Convert a track in the browser with ffmpeg.wasm.
 *
 * The dialog is explicit about what is happening, because the trade-offs are
 * real: the first run downloads the converter (~30 MB), the whole file is held
 * in memory, and the result appears as a download or a one-off queue entry —
 * nothing is uploaded and the server does no work.
 */
import type { MusicTrack } from '../../composables/useMusic'
import { DEFAULT_TRANSCODE_TARGET, TRANSCODE_TARGETS, canPlayMime, parseTranscodeTarget } from '../../utils/transcode'

const props = defineProps<{ track: MusicTrack }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const toast = useToast()
const { convert, fetchAudio, progress, state, error } = useAudioTranscode()
const { playQueue } = useMusicPlayer()

const target = ref(DEFAULT_TRANSCODE_TARGET)
const result = ref<{ url: string, filename: string, size: number } | null>(null)

const targetItems = computed(() => TRANSCODE_TARGETS.map(item => ({
  label: t(item.labelKey),
  value: item.key
})))

const progressPercent = computed(() => Math.round(progress.value * 100))
const browserCannotPlay = computed(() => !canPlayMime(props.track.mimeType))
const working = computed(() => state.value === 'loading' || state.value === 'running')

async function start(): Promise<void> {
  const resolved = parseTranscodeTarget(target.value)
  if (!resolved) return
  result.value = null
  try {
    const source = await fetchAudio(props.track.streamUrl)
    const converted = await convert(source, resolved, {
      sourceName: `${props.track.title}.${props.track.format}`
    })
    result.value = { url: converted.url, filename: converted.filename, size: converted.size }
    toast.add({ title: t('music.transcode.done'), color: 'success' })
  } catch (cause) {
    toast.add({
      title: t('music.transcode.failed', { reason: error.value ?? String(cause) }),
      color: 'error'
    })
  }
}

function download(): void {
  if (!result.value) return
  const link = document.createElement('a')
  link.href = result.value.url
  link.download = result.value.filename
  link.click()
}

function play(): void {
  if (!result.value) return
  const convertedUrl = result.value.url
  // A one-off queue entry: a negative id keeps it out of the catalogue's id space.
  playQueue([{
    ...props.track,
    id: -Math.floor(Date.now() / 1000),
    title: `${props.track.title} · ${target.value}`,
    streamUrl: convertedUrl,
    size: result.value.size
  }], 0)
  close()
}

function close(): void {
  if (result.value) URL.revokeObjectURL(result.value.url)
  emit('close')
}
</script>

<template>
  <UModal
    :open="true"
    :title="t('music.transcode.title')"
    @update:open="close"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          {{ t('music.transcode.description') }}
        </p>

        <UAlert
          v-if="browserCannotPlay"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :description="t('music.player.unsupported')"
        />

        <div class="flex items-center gap-3">
          <MusicCoverArt
            :src="track.coverUrl"
            :name="track.albumName"
            size="sm"
          />
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">
              {{ track.title }}
            </p>
            <p class="truncate text-xs text-muted">
              {{ track.format.toUpperCase() }}
              <span v-if="track.bitrate"> · {{ track.bitrate }} kbps</span>
              <span v-if="track.size"> · {{ formatBytes(track.size) }}</span>
            </p>
          </div>
        </div>

        <UFormField :label="t('music.transcode.title')">
          <USelect
            v-model="target"
            :items="targetItems"
            class="w-full"
          />
        </UFormField>

        <div
          v-if="working"
          class="space-y-1"
        >
          <UProgress
            :model-value="progressPercent"
            :max="100"
          />
          <p class="text-xs text-muted">
            {{ state === 'loading'
              ? t('music.transcode.loading')
              : t('music.transcode.converting', { percent: progressPercent }) }}
          </p>
        </div>

        <div
          v-else-if="result"
          class="rounded-lg border border-default p-3 text-sm"
        >
          <p class="font-medium">
            {{ t('music.transcode.done') }}
          </p>
          <p class="text-xs text-muted">
            {{ result.filename }} · {{ formatBytes(result.size) }}
          </p>
        </div>

        <p class="text-xs text-muted">
          {{ t('music.transcode.note') }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          :label="t('music.actions.close')"
          color="neutral"
          variant="ghost"
          @click="close"
        />
        <template v-if="result">
          <UButton
            icon="i-lucide-play"
            :label="t('music.transcode.playResult')"
            color="neutral"
            variant="subtle"
            @click="play"
          />
          <UButton
            icon="i-lucide-download"
            :label="t('music.transcode.download')"
            @click="download"
          />
        </template>
        <UButton
          v-else
          icon="i-lucide-refresh-cw"
          :label="t('music.transcode.start')"
          :loading="working"
          @click="start"
        />
      </div>
    </template>
  </UModal>
</template>
