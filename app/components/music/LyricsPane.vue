<script setup lang="ts">
/**
 * Lyrics for the current track.
 *
 * The API returns the raw text (embedded USLT/LYRICS tag, else a sidecar `.lrc`),
 * and the parsing happens here so the same panel handles both timed and untimed
 * lyrics. Timed lines highlight with playback and scroll themselves into view;
 * clicking a line seeks to it.
 */
import { activeLyricIndex, parseLyrics } from '../../utils/lyrics'

const { t } = useI18n()
const { current, currentTime, seek } = useMusicPlayer()

const raw = ref<string | null>(null)
const loading = ref(false)
const list = ref<HTMLElement | null>(null)

const parsed = computed(() => parseLyrics(raw.value))
const active = computed(() => activeLyricIndex(parsed.value.lines, currentTime.value))

watch(() => current.value?.id, async (id) => {
  raw.value = null
  // Converted one-off entries have negative ids: nothing is stored for them.
  if (!id || id < 0) return
  loading.value = true
  try {
    const data = await cGet<{ lyrics: string | null }>(`/api/music/tracks/${id}`)
    raw.value = data.lyrics
  } catch {
    raw.value = null
  } finally {
    loading.value = false
  }
}, { immediate: true })

watch(active, async (index) => {
  await nextTick()
  if (index < 0) return
  list.value?.querySelector<HTMLElement>(`[data-line="${index}"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})
</script>

<template>
  <div class="border-t border-default bg-elevated/40">
    <div class="mx-auto max-w-3xl px-4 py-3">
      <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        {{ t('music.player.lyrics') }}
      </p>

      <div
        v-if="loading"
        class="py-6 text-center text-sm text-muted"
      >
        {{ t('music.messages.loadFailed') }}
      </div>

      <div
        v-else-if="!parsed.lines.length"
        class="py-6 text-center text-sm text-muted"
      >
        {{ t('music.player.noLyrics') }}
      </div>

      <div
        v-else
        ref="list"
        class="max-h-56 overflow-y-auto pr-2"
      >
        <button
          v-for="(line, index) in parsed.lines"
          :key="`${index}-${line.time}`"
          type="button"
          :data-line="index"
          class="block w-full rounded px-2 py-1 text-left text-sm transition-colors"
          :class="[
            index === active && parsed.synced
              ? 'bg-primary/10 font-medium text-primary'
              : 'text-muted hover:text-highlighted',
            parsed.synced ? 'cursor-pointer' : 'cursor-default'
          ]"
          @click="parsed.synced && line.time >= 0 && seek(line.time)"
        >
          {{ line.text }}
        </button>
      </div>
    </div>
  </div>
</template>
