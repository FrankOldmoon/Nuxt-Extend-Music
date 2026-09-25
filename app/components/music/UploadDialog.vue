<script setup lang="ts">
/**
 * Upload audio files.
 *
 * Posts multipart via `XMLHttpRequest` rather than `$fetch` purely for
 * `upload.onprogress`: music files are large enough that a determinate progress
 * bar is worth the few extra lines.
 *
 * The response reports per-file outcomes, and they are shown verbatim — "3
 * imported, 2 already in the library, 1 failed" is far more useful than a single
 * success/失败 toast when uploading an album.
 */
const emit = defineEmits<{ close: [], uploaded: [] }>()

const { t } = useI18n()
const toast = useToast()

interface UploadResult {
  imported: number
  duplicates: number
  failed: number
  results: Array<{ filename: string, ok: boolean, duplicate?: boolean, reason?: string }>
}

const files = ref<File[]>([])
const isPublic = ref(true)
const genre = ref('')
const artist = ref('')
const album = ref('')
const uploading = ref(false)
const progress = ref(0)
const result = ref<UploadResult | null>(null)
const error = ref<string | null>(null)
const dragging = ref(false)

function addFiles(list: FileList | null | undefined): void {
  if (!list) return
  const known = new Set(files.value.map(file => `${file.name}:${file.size}`))
  for (const file of Array.from(list)) {
    const key = `${file.name}:${file.size}`
    if (!known.has(key)) files.value.push(file)
  }
}

function onPick(event: Event): void {
  addFiles((event.target as HTMLInputElement).files)
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  addFiles(event.dataTransfer?.files)
}

function remove(index: number): void {
  files.value.splice(index, 1)
}

function send(): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    for (const file of files.value) form.append('files', file)
    form.append('isPublic', String(isPublic.value))
    if (genre.value.trim()) form.append('genre', genre.value.trim())
    if (artist.value.trim()) form.append('artist', artist.value.trim())
    if (album.value.trim()) form.append('album', album.value.trim())

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/music/tracks/upload')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) progress.value = event.loaded / event.total
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResult)
        } catch {
          reject(new Error('Malformed response'))
        }
      } else {
        reject(new Error(`HTTP ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(form)
  })
}

async function upload(): Promise<void> {
  if (!files.value.length) return
  uploading.value = true
  error.value = null
  progress.value = 0
  try {
    result.value = await send()
    const summary = result.value
    toast.add({
      title: t('music.upload.imported', { count: summary.imported }),
      description: [
        summary.duplicates ? t('music.upload.duplicates', { count: summary.duplicates }) : '',
        summary.failed ? t('music.upload.failed', { count: summary.failed }) : ''
      ].filter(Boolean).join(' · ') || undefined,
      color: summary.failed ? 'warning' : 'success'
    })
    files.value = []
    emit('uploaded')
  } catch (cause) {
    error.value = extractErrorMessage(cause)
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <UModal
    :open="true"
    :title="t('music.upload.title')"
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

        <div
          class="rounded-lg border-2 border-dashed border-default p-6 text-center transition-colors"
          :class="dragging && 'border-primary bg-primary/5'"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          <UIcon
            name="i-lucide-music-4"
            class="mx-auto mb-2 size-8 text-muted"
          />
          <p class="text-sm">
            {{ t('music.upload.drop') }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ t('music.upload.hint') }}
          </p>
          <label class="mt-3 inline-block">
            <input
              type="file"
              multiple
              accept="audio/*,.mp3,.flac,.m4a,.mp4,.aac,.ogg,.oga,.opus"
              class="hidden"
              @change="onPick"
            >
            <UButton
              :label="t('music.upload.choose')"
              icon="i-lucide-folder-open"
              color="neutral"
              variant="subtle"
              size="sm"
              as="span"
            />
          </label>
        </div>

        <ul
          v-if="files.length"
          class="max-h-40 space-y-1 overflow-y-auto text-sm"
        >
          <li
            v-for="(file, index) in files"
            :key="`${file.name}-${index}`"
            class="flex items-center gap-2 rounded px-2 py-1 hover:bg-elevated"
          >
            <span class="min-w-0 flex-1 truncate">{{ file.name }}</span>
            <span class="shrink-0 text-xs text-muted">{{ formatBytes(file.size) }}</span>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="remove(index)"
            />
          </li>
        </ul>

        <UFormField :label="t('music.upload.isPublic')">
          <USwitch v-model="isPublic" />
        </UFormField>

        <details class="rounded-lg border border-default p-3">
          <summary class="cursor-pointer text-sm">
            {{ t('music.track.genre') }} / {{ t('music.track.artist') }} / {{ t('music.track.album') }}
          </summary>
          <p class="mt-1 text-xs text-muted">
            {{ t('music.upload.categoryHint') }}
          </p>
          <div class="mt-2 grid gap-2 sm:grid-cols-3">
            <UInput
              v-model="genre"
              :placeholder="t('music.track.genre')"
              size="sm"
            />
            <UInput
              v-model="artist"
              :placeholder="t('music.track.artist')"
              size="sm"
            />
            <UInput
              v-model="album"
              :placeholder="t('music.track.album')"
              size="sm"
            />
          </div>
        </details>

        <div
          v-if="uploading"
          class="space-y-1"
        >
          <UProgress
            :model-value="Math.round(progress * 100)"
            :max="100"
          />
          <p class="text-xs text-muted">
            {{ t('music.upload.uploading') }}
          </p>
        </div>

        <div
          v-if="result"
          class="rounded-lg border border-default p-3 text-sm"
        >
          <p>
            {{ t('music.upload.imported', { count: result.imported }) }}
            <span v-if="result.duplicates"> · {{ t('music.upload.duplicates', { count: result.duplicates }) }}</span>
            <span v-if="result.failed"> · {{ t('music.upload.failed', { count: result.failed }) }}</span>
          </p>
          <ul class="mt-1 space-y-0.5 text-xs text-muted">
            <li
              v-for="row in result.results.filter(item => !item.ok)"
              :key="row.filename"
            >
              {{ row.filename }} — {{ row.reason }}
            </li>
          </ul>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          :label="t('music.actions.close')"
          color="neutral"
          variant="ghost"
          @click="emit('close')"
        />
        <UButton
          icon="i-lucide-upload"
          :label="t('music.actions.upload')"
          :loading="uploading"
          :disabled="!files.length"
          @click="upload"
        />
      </div>
    </template>
  </UModal>
</template>
