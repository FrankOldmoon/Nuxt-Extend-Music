<script setup lang="ts">
/**
 * Now playing — one track, full screen.
 *
 * Left half: the artwork and what the file actually is. Right half: the lyrics,
 * scrolling on their own with the current line kept in the middle — for a timed
 * `.lrc` that reads like karaoke, and clicking a line seeks to it.
 *
 * Opening the page plays the track: the click that got here is the gesture
 * browsers want, so the page doubles as a deep link into playback. If the viewer
 * arrived by pasting a URL, playback may be refused — the transport is right
 * there, which is why the page carries its own play/pause.
 */
import type { MusicTrack } from '../../../composables/useMusic'
import { formatDuration } from '../../../composables/useMusic'
import { activeLyricIndex, parseLyrics } from '../../../utils/lyrics'

definePageMeta({ layout: 'music' })

const route = useRoute()
const { t } = useI18n()
const toast = useToast()
const { isLoggedIn } = useAuth()
const { current, playing, currentTime, duration, toggle, next, previous, seek, enqueue, playQueue } = useMusicPlayer()

const id = computed(() => Number(route.params.id))

const { data, error } = await useAsyncData(
  `music:track:${id.value}`,
  () => cGet<{ track: MusicTrack, lyrics: string | null }>(`/api/music/tracks/${id.value}`)
)

const track = computed(() => data.value?.track ?? null)
const lyrics = computed(() => data.value?.lyrics ?? null)
const parsed = computed(() => parseLyrics(lyrics.value))
const active = computed(() => activeLyricIndex(parsed.value.lines, currentTime.value))

const isCurrent = computed(() => track.value != null && current.value?.id === track.value.id)
/** Live values while this is the playing track; the file's own duration otherwise. */
const elapsed = computed(() => (isCurrent.value ? currentTime.value : 0))
const total = computed(() => (isCurrent.value ? duration.value : track.value?.duration ?? 0))
const percent = computed(() => (total.value > 0 ? Math.min(100, (elapsed.value / total.value) * 100) : 0))

const roster = ref<HTMLElement | null>(null)

const details = computed(() => {
  const value = track.value
  if (!value) return []
  const rows: Array<{ key: string, label: string, value: string }> = []
  if (value.year) rows.push({ key: 'year', label: t('music.track.year'), value: String(value.year) })
  if (value.trackNo) rows.push({ key: 'trackNo', label: t('music.track.trackNo'), value: String(value.trackNo) })
  if (value.genreName) rows.push({ key: 'genre', label: t('music.track.genre'), value: value.genreName })
  if (value.format) rows.push({ key: 'format', label: t('music.track.format'), value: value.format.toUpperCase() })
  if (value.bitrate) rows.push({ key: 'bitrate', label: t('music.track.bitrate'), value: `${Math.round(value.bitrate / 1000)} kbps` })
  if (value.sampleRate) rows.push({ key: 'sampleRate', label: t('music.track.sampleRate'), value: `${(value.sampleRate / 1000).toFixed(value.sampleRate % 1000 ? 1 : 0)} kHz` })
  if (value.channels) rows.push({ key: 'channels', label: t('music.track.channels'), value: String(value.channels) })
  if (value.size) rows.push({ key: 'size', label: t('music.track.size'), value: formatBytes(value.size) })
  rows.push({ key: 'duration', label: t('music.track.duration'), value: formatDuration(value.duration) })
  rows.push({ key: 'plays', label: t('music.track.plays'), value: String(value.playCount ?? 0) })
  return rows
})

async function toggleStar(): Promise<void> {
  const value = track.value
  if (!value) return
  if (!isLoggedIn.value) {
    toast.add({ title: t('music.messages.notSignedIn'), color: 'warning' })
    return
  }
  try {
    const result = await cPost<{ starred: boolean }>('/api/music/stars', { type: 'track', id: value.id })
    value.starred = result.starred
  } catch (err) {
    toast.add({ title: extractErrorMessage(err), color: 'error' })
  }
}

const playlistTarget = ref<MusicTrack | null>(null)
const transcodeTarget = ref<MusicTrack | null>(null)
const editTarget = ref<MusicTrack | null>(null)

function menuItems(value: MusicTrack): Array<Record<string, unknown>> {
  return [
    { label: t('music.actions.addToQueue'), icon: 'i-lucide-list-plus', onSelect: () => enqueue(value) },
    { label: t('music.actions.addToPlaylist'), icon: 'i-lucide-list-music', onSelect: () => { playlistTarget.value = value } },
    { label: t('music.actions.convert'), icon: 'i-lucide-refresh-cw', onSelect: () => { transcodeTarget.value = value } },
    { label: t('music.actions.download'), icon: 'i-lucide-download', onSelect: () => window.open(value.streamUrl, '_blank') },
    ...(value.canEdit
      ? [{ label: t('music.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => { editTarget.value = value } }]
      : [])
  ]
}

/** Start this track when the page is opened for a track that is not playing. */
function maybePlay(value: MusicTrack | null): void {
  if (value && current.value?.id !== value.id) playQueue([value])
}

onMounted(() => {
  maybePlay(track.value)
  watch(track, value => maybePlay(value))
})

/** Keep the current line in the middle of the lyric column. */
watch(active, async (index) => {
  await nextTick()
  if (index < 0) return
  roster.value?.querySelector<HTMLElement>(`[data-line="${index}"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})
</script>

<template>
  <div>
    <UAlert
      v-if="error || !track"
      color="error"
      variant="subtle"
      :description="t('music.messages.loadFailed')"
    />

    <div
      v-else
      class="grid min-h-[520px] gap-10 lg:h-[calc(100vh-var(--ui-header-height)-9rem)] lg:grid-cols-2"
    >
      <!-- Left: the record itself -->
      <div class="flex flex-col gap-6 lg:overflow-y-auto lg:pr-4">
        <p class="text-xs font-medium uppercase tracking-[0.2em] text-primary">
          {{ t('music.player.nowPlaying') }}
        </p>

        <div class="w-full max-w-md">
          <MusicCoverArt
            :src="track.coverUrl"
            :name="track.albumName"
            fill
            rounded="lg"
          />
        </div>

        <div class="space-y-3">
          <h1 class="text-2xl font-semibold leading-tight sm:text-3xl">
            {{ track.title }}
          </h1>
          <p class="text-sm">
            <NuxtLink
              v-if="track.artistId"
              :to="`/music/artists/${track.artistId}`"
              class="font-medium text-primary hover:underline"
            >
              {{ track.artistName ?? t('music.track.unknownArtist') }}
            </NuxtLink>
            <span
              v-else
              class="font-medium"
            >{{ t('music.track.unknownArtist') }}</span>
            <template v-if="track.albumName">
              <span class="mx-2 text-muted">·</span>
              <NuxtLink
                v-if="track.albumId"
                :to="`/music/albums/${track.albumId}`"
                class="text-muted hover:text-highlighted"
              >
                {{ track.albumName }}
              </NuxtLink>
              <span
                v-else
                class="text-muted"
              >{{ track.albumName }}</span>
            </template>
          </p>
        </div>

        <!-- Transport + scrubber -->
        <div class="space-y-3">
          <div class="flex items-center gap-4">
            <UButton
              icon="i-lucide-skip-back"
              color="neutral"
              variant="ghost"
              :title="t('music.player.prev')"
              @click="previous"
            />
            <UButton
              :icon="isCurrent && playing ? 'i-lucide-pause' : 'i-lucide-play'"
              size="xl"
              class="rounded-full"
              :title="isCurrent && playing ? t('music.player.pause') : t('music.player.play')"
              @click="isCurrent ? toggle() : maybePlay(track)"
            />
            <UButton
              icon="i-lucide-skip-forward"
              color="neutral"
              variant="ghost"
              :title="t('music.player.next')"
              @click="next"
            />
            <span class="ml-1 text-xs tabular-nums text-muted">
              {{ formatDuration(elapsed) }} / {{ formatDuration(total) }}
            </span>
          </div>

          <USlider
            :model-value="percent"
            :max="100"
            :step="0.1"
            :disabled="!isCurrent"
            @update:model-value="(value: number) => seek((value / 100) * total)"
          />
        </div>

        <!-- Actions -->
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            :icon="track.starred ? 'i-lucide-star' : 'i-lucide-star'"
            :label="track.starred ? t('music.actions.unstar') : t('music.actions.star')"
            :color="track.starred ? 'warning' : 'neutral'"
            :variant="track.starred ? 'subtle' : 'ghost'"
            size="sm"
            @click="toggleStar"
          />
          <UButton
            icon="i-lucide-list-music"
            :label="t('music.actions.addToPlaylist')"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="playlistTarget = track"
          />
          <UDropdownMenu
            :items="menuItems(track)"
            :content="{ align: 'start' }"
          >
            <UButton
              icon="i-lucide-ellipsis"
              color="neutral"
              variant="ghost"
              size="sm"
            />
          </UDropdownMenu>
        </div>

        <!-- The file's own facts -->
        <dl class="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-default pt-5 text-sm">
          <div
            v-for="row in details"
            :key="row.key"
            class="flex items-baseline justify-between gap-3"
          >
            <dt class="text-muted">
              {{ row.label }}
            </dt>
            <dd class="truncate font-medium tabular-nums">
              {{ row.value }}
            </dd>
          </div>
        </dl>
      </div>

      <!-- Right: the lyrics, half the screen -->
      <div class="flex min-h-0 flex-col lg:overflow-hidden">
        <p class="mb-3 shrink-0 text-xs font-medium uppercase tracking-[0.2em] text-muted">
          {{ t('music.player.lyrics') }}
        </p>

        <div
          v-if="!parsed.lines.length"
          class="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-default px-6 py-16 text-center text-sm text-muted"
        >
          {{ t('music.player.noLyrics') }}
        </div>

        <div
          v-else
          ref="roster"
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-2xl border border-default bg-elevated/20 px-6 py-10 lg:px-8"
        >
          <button
            v-for="(line, index) in parsed.lines"
            :key="`${index}-${line.time}`"
            type="button"
            :data-line="index"
            class="block w-full rounded px-1 py-2 text-left text-lg leading-relaxed transition-colors"
            :class="[
              index === active && parsed.synced
                ? 'font-semibold text-primary'
                : 'text-muted hover:text-highlighted',
              parsed.synced ? 'cursor-pointer' : 'cursor-default'
            ]"
            @click="parsed.synced && line.time >= 0 && seek(line.time)"
          >
            {{ line.text || '♪' }}
          </button>
        </div>
      </div>
    </div>

    <MusicAddToPlaylistDialog
      v-if="playlistTarget"
      :track="playlistTarget"
      @close="playlistTarget = null"
    />
    <MusicTranscodeDialog
      v-if="transcodeTarget"
      :track="transcodeTarget"
      @close="transcodeTarget = null"
    />
    <MusicTrackEditDialog
      v-if="editTarget"
      :track="editTarget"
      @close="editTarget = null"
    />
  </div>
</template>
