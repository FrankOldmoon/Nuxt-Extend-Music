<script setup lang="ts">
/**
 * The bottom transport bar.
 *
 * Renders only when something is queued (the layout decides that), so the empty
 * state is simply absence. The queue and lyric panels live above it in the
 * layout and are toggled from here, which keeps this component to transport
 * controls and avoids pinning a popover to a fixed-position bar.
 */
import { formatDuration } from '../../composables/useMusic'

defineProps<{ panel: 'none' | 'queue' | 'lyrics' }>()
const emit = defineEmits<{ togglePanel: [value: 'queue' | 'lyrics'] }>()

const { t } = useI18n()
const {
  current,
  playing,
  loading,
  failed,
  currentTime,
  duration,
  volume,
  muted,
  shuffle,
  repeat,
  toggle,
  next,
  previous,
  seek,
  setVolume,
  toggleMute,
  toggleShuffle,
  cycleRepeat
} = useMusicPlayer()

// Local scrub state: while dragging, the displayed position follows the thumb
// rather than the audio element, which otherwise fights the drag.
const scrubbing = ref(false)
const scrubValue = ref(0)

watch(currentTime, (value) => {
  if (!scrubbing.value) scrubValue.value = value
})

const total = computed(() => duration.value || current.value?.duration || 0)
const displayed = computed(() => (scrubbing.value ? scrubValue.value : currentTime.value))
const progressPercent = computed(() => (total.value > 0 ? (displayed.value / total.value) * 100 : 0))

const repeatLabel = computed(() => {
  const suffix = repeat.value === 'off' ? 'Off' : repeat.value === 'all' ? 'All' : 'One'
  return t(`music.player.repeat${suffix}`)
})

function onScrubInput(event: Event): void {
  scrubbing.value = true
  scrubValue.value = Number((event.target as HTMLInputElement).value)
}

function onScrubCommit(): void {
  seek(scrubValue.value)
  scrubbing.value = false
}
</script>

<template>
  <div class="border-t border-default bg-default/95 backdrop-blur">
    <div class="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-3 py-2 sm:px-4">
      <!-- Now playing -->
      <div class="flex min-w-0 flex-1 items-center gap-3 sm:flex-none sm:basis-64">
        <MusicCoverArt
          :src="current?.coverUrl"
          :name="current?.albumName"
          size="sm"
        />
        <div class="min-w-0">
          <p
            class="truncate text-sm font-medium"
            :title="current?.title"
          >
            {{ current?.title ?? t('music.player.nowPlaying') }}
          </p>
          <p class="truncate text-xs text-muted">
            {{ current?.artistName ?? '' }}
          </p>
        </div>
        <UButton
          v-if="failed"
          icon="i-lucide-triangle-alert"
          color="warning"
          variant="ghost"
          size="xs"
          :title="t('music.player.playbackFailed')"
        />
      </div>

      <!-- Transport -->
      <div class="order-last flex w-full flex-col items-center gap-1 sm:order-none sm:w-auto sm:flex-1">
        <div class="flex items-center gap-1">
          <UButton
            icon="i-lucide-shuffle"
            :color="shuffle ? 'primary' : 'neutral'"
            variant="ghost"
            size="sm"
            :title="t('music.player.shuffle')"
            @click="toggleShuffle"
          />
          <UButton
            icon="i-lucide-skip-back"
            color="neutral"
            variant="ghost"
            size="sm"
            :title="t('music.player.prev')"
            @click="previous"
          />
          <UButton
            :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
            color="primary"
            variant="solid"
            size="md"
            :loading="loading"
            :title="playing ? t('music.player.pause') : t('music.player.play')"
            @click="toggle"
          />
          <UButton
            icon="i-lucide-skip-forward"
            color="neutral"
            variant="ghost"
            size="sm"
            :title="t('music.player.next')"
            @click="next"
          />
          <UButton
            :icon="repeat === 'one' ? 'i-lucide-repeat-1' : 'i-lucide-repeat'"
            :color="repeat === 'off' ? 'neutral' : 'primary'"
            variant="ghost"
            size="sm"
            :title="repeatLabel"
            @click="cycleRepeat"
          />
        </div>

        <div class="flex w-full items-center gap-2">
          <span class="w-10 shrink-0 text-right text-xs tabular-nums text-muted">
            {{ formatDuration(displayed) }}
          </span>
          <div class="relative flex-1">
            <UProgress
              :model-value="progressPercent"
              :max="100"
              size="xs"
            />
            <input
              class="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent"
              type="range"
              min="0"
              :max="Math.max(1, Math.floor(total))"
              step="1"
              :value="displayed"
              @input="onScrubInput"
              @change="onScrubCommit"
            >
          </div>
          <span class="w-10 shrink-0 text-xs tabular-nums text-muted">
            {{ formatDuration(total) }}
          </span>
        </div>
      </div>

      <!-- Volume + panels -->
      <div class="flex items-center gap-1 sm:basis-64 sm:justify-end">
        <UButton
          icon="i-lucide-list-music"
          :color="panel === 'queue' ? 'primary' : 'neutral'"
          variant="ghost"
          size="sm"
          :title="t('music.player.queue')"
          @click="emit('togglePanel', 'queue')"
        />
        <UButton
          icon="i-lucide-mic-vocal"
          :color="panel === 'lyrics' ? 'primary' : 'neutral'"
          variant="ghost"
          size="sm"
          :title="t('music.player.lyrics')"
          @click="emit('togglePanel', 'lyrics')"
        />
        <UButton
          :icon="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
          color="neutral"
          variant="ghost"
          size="sm"
          :title="muted ? t('music.player.unmute') : t('music.player.mute')"
          @click="toggleMute"
        />
        <input
          class="hidden w-24 cursor-pointer accent-primary sm:block"
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="muted ? 0 : volume"
          :title="t('music.player.volume')"
          @input="setVolume(Number(($event.target as HTMLInputElement).value))"
        >
      </div>
    </div>
  </div>
</template>
