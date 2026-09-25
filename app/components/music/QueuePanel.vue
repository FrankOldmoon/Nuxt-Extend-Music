<script setup lang="ts">
/**
 * The play queue.
 *
 * Shown in the layout above the transport bar rather than in a popover: the bar
 * is fixed to the bottom of the viewport, and an upward-opening popover from a
 * fixed element is fragile on small screens.
 */
import { formatDuration } from '../../composables/useMusic'

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { queue, current, jumpTo, removeFromQueue, clearQueue } = useMusicPlayer()
</script>

<template>
  <div class="border-t border-default bg-elevated/60">
    <div class="mx-auto max-w-3xl px-4 py-3">
      <div class="mb-2 flex items-center justify-between">
        <p class="text-xs font-medium uppercase tracking-wide text-muted">
          {{ t('music.player.queue') }} · {{ queue.length }}
        </p>
        <div class="flex items-center gap-1">
          <UButton
            icon="i-lucide-trash-2"
            :label="t('music.player.clearQueue')"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="clearQueue"
          />
          <UButton
            icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="emit('close')"
          />
        </div>
      </div>

      <div class="max-h-56 overflow-y-auto pr-1">
        <div
          v-for="(track, position) in queue"
          :key="`${track.id}-${position}`"
          class="group flex items-center gap-2 rounded px-2 py-1.5"
          :class="track.id === current?.id ? 'bg-primary/10' : 'hover:bg-elevated'"
        >
          <button
            type="button"
            class="min-w-0 flex-1 cursor-pointer text-left"
            @click="jumpTo(position)"
          >
            <span
              class="block truncate text-sm"
              :class="track.id === current?.id && 'font-medium text-primary'"
            >
              {{ track.title }}
            </span>
            <span class="block truncate text-xs text-muted">{{ track.artistName ?? '' }}</span>
          </button>
          <span class="shrink-0 text-xs tabular-nums text-muted">{{ formatDuration(track.duration) }}</span>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            class="opacity-0 group-hover:opacity-100"
            @click="removeFromQueue(position)"
          />
        </div>
      </div>

      <p
        v-if="!queue.length"
        class="py-4 text-center text-sm text-muted"
      >
        {{ t('music.player.emptyQueue') }}
      </p>
    </div>
  </div>
</template>
