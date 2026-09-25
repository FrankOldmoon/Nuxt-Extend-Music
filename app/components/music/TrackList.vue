<script setup lang="ts">
/**
 * The track list — the one list every page reuses (album, artist, genre,
 * playlist, favourites, search, "all tracks").
 *
 * It owns the per-track actions, including the three dialogs that act on a
 * single track, so pages stay thin. Actions are hidden rather than disabled when
 * the viewer is not allowed to use them: a read-only visitor sees a clean list.
 */
import type { MusicTrack } from '../../composables/useMusic'
import { formatDuration } from '../../composables/useMusic'

const props = withDefaults(defineProps<{
  tracks: MusicTrack[]
  showAlbum?: boolean
  showCover?: boolean
  numbering?: boolean
  /** Show edit/delete. Individual rows still check `track.canEdit`. */
  manage?: boolean
  /** When set, rows gain a "remove from this playlist" action. */
  playlistId?: number | null
}>(), {
  showAlbum: true,
  showCover: true,
  numbering: true,
  manage: true,
  playlistId: null
})

const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const toast = useToast()
const { isLoggedIn } = useAuth()
const {
  current,
  playing,
  playQueue,
  playNext,
  enqueue
} = useMusicPlayer()

const playlistTarget = ref<MusicTrack | null>(null)
const editTarget = ref<MusicTrack | null>(null)
const transcodeTarget = ref<MusicTrack | null>(null)

const currentId = computed(() => current.value?.id ?? null)

function isCurrent(track: MusicTrack): boolean {
  return currentId.value === track.id
}

function playFrom(position: number): void {
  playQueue(props.tracks, position)
}

async function toggleStar(track: MusicTrack): Promise<void> {
  if (!isLoggedIn.value) {
    toast.add({ title: t('music.messages.notSignedIn'), color: 'warning' })
    return
  }
  try {
    const result = await cPost<{ starred: boolean }>('/api/music/stars', { type: 'track', id: track.id })
    track.starred = result.starred
  } catch (error) {
    toast.add({ title: extractErrorMessage(error), color: 'error' })
  }
}

function download(track: MusicTrack): void {
  // The stream endpoint sets Content-Type but not Content-Disposition, so a
  // direct navigation downloads it under the file's own name.
  window.open(track.streamUrl, '_blank')
}

async function remove(track: MusicTrack): Promise<void> {
  if (!window.confirm(t('music.messages.confirmDelete'))) return
  try {
    await cDelete(`/api/music/tracks/${track.id}`)
    toast.add({ title: t('music.messages.deleted'), color: 'success' })
    emit('changed')
  } catch (error) {
    toast.add({ title: extractErrorMessage(error), color: 'error' })
  }
}

async function removeFromPlaylist(track: MusicTrack): Promise<void> {
  if (props.playlistId == null) return
  try {
    await cPost(`/api/music/playlists/${props.playlistId}/tracks`, {
      action: 'remove',
      trackIds: [track.id]
    })
    toast.add({ title: t('music.messages.saved'), color: 'success' })
    emit('changed')
  } catch (error) {
    toast.add({ title: extractErrorMessage(error), color: 'error' })
  }
}

function menuItems(track: MusicTrack): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [
    { label: t('music.actions.playNext'), icon: 'i-lucide-list-start', onSelect: () => playNext(track) },
    { label: t('music.actions.addToQueue'), icon: 'i-lucide-list-plus', onSelect: () => enqueue(track) },
    {
      label: t('music.actions.addToPlaylist'),
      icon: 'i-lucide-list-music',
      onSelect: () => {
        playlistTarget.value = track
      }
    },
    {
      label: t('music.actions.convert'),
      icon: 'i-lucide-refresh-cw',
      onSelect: () => {
        transcodeTarget.value = track
      }
    },
    { label: t('music.actions.download'), icon: 'i-lucide-download', onSelect: () => download(track) }
  ]
  if (props.playlistId != null) {
    items.push({
      label: t('music.playlists.removeFromPlaylist'),
      icon: 'i-lucide-list-x',
      onSelect: () => void removeFromPlaylist(track)
    })
  }
  if (track.canEdit) {
    items.push({
      label: t('music.actions.edit'),
      icon: 'i-lucide-pencil',
      onSelect: () => {
        editTarget.value = track
      }
    })
    items.push({ label: t('music.actions.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => void remove(track) })
  }
  return items
}
</script>

<template>
  <div
    v-if="!tracks.length"
    class="px-3 py-10 text-center text-sm text-muted"
  >
    {{ t('music.empty.noTracks') }}
  </div>

  <div
    v-else
    class="divide-y divide-default"
  >
    <div
      v-for="(track, position) in tracks"
      :key="track.id"
      class="group flex items-center gap-3 px-2 py-2 sm:px-3"
      :class="isCurrent(track) ? 'bg-primary/10' : 'hover:bg-elevated/60'"
    >
      <button
        type="button"
        class="flex w-7 shrink-0 cursor-pointer items-center justify-center text-muted"
        :title="playing && isCurrent(track) ? t('music.player.pause') : t('music.player.play')"
        @click="playFrom(position)"
      >
        <UIcon
          v-if="isCurrent(track) && playing"
          name="i-lucide-volume-2"
          class="size-4 text-primary"
        />
        <template v-else>
          <span class="text-xs tabular-nums group-hover:hidden">
            {{ numbering ? (track.trackNo ?? position + 1) : position + 1 }}
          </span>
          <UIcon
            name="i-lucide-play"
            class="hidden size-4 group-hover:block"
          />
        </template>
      </button>

      <MusicCoverArt
        v-if="showCover"
        :src="track.coverUrl"
        :name="track.albumName"
        size="sm"
      />

      <div class="min-w-0 flex-1">
        <p
          class="truncate text-sm font-medium"
          :class="isCurrent(track) && 'text-primary'"
          :title="track.title"
        >
          {{ track.title }}
        </p>
        <p class="truncate text-xs text-muted">
          <NuxtLink
            v-if="track.artistId"
            :to="`/music/artists/${track.artistId}`"
            class="hover:text-primary hover:underline"
          >
            {{ track.artistName ?? t('music.track.unknownArtist') }}
          </NuxtLink>
          <span v-else>{{ t('music.track.unknownArtist') }}</span>
          <template v-if="!showAlbum && track.albumName">
            <span> · </span>
            <span>{{ track.albumName }}</span>
          </template>
        </p>
      </div>

      <NuxtLink
        v-if="showAlbum && track.albumId"
        :to="`/music/albums/${track.albumId}`"
        class="hidden max-w-48 truncate text-xs text-muted hover:text-primary hover:underline md:block"
      >
        {{ track.albumName }}
      </NuxtLink>

      <UBadge
        v-if="!track.isPublic"
        color="neutral"
        variant="subtle"
        size="sm"
        class="hidden lg:inline-flex"
      >
        {{ t('music.visibility.private') }}
      </UBadge>

      <span class="w-14 shrink-0 text-right text-xs tabular-nums text-muted">
        {{ formatDuration(track.duration) }}
      </span>

      <UButton
        :icon="track.starred ? 'i-lucide-star' : 'i-lucide-star-off'"
        :color="track.starred ? 'warning' : 'neutral'"
        variant="ghost"
        size="xs"
        :title="track.starred ? t('music.actions.unstar') : t('music.actions.star')"
        @click="toggleStar(track)"
      />

      <UDropdownMenu
        :items="menuItems(track)"
        :content="{ align: 'end' }"
      >
        <UButton
          icon="i-lucide-more-vertical"
          color="neutral"
          variant="ghost"
          size="xs"
        />
      </UDropdownMenu>
    </div>
  </div>

  <MusicAddToPlaylistDialog
    v-if="playlistTarget"
    :track="playlistTarget"
    @close="playlistTarget = null"
  />
  <MusicTrackEditDialog
    v-if="editTarget"
    :track="editTarget"
    @close="editTarget = null"
    @saved="emit('changed')"
  />
  <MusicTranscodeDialog
    v-if="transcodeTarget"
    :track="transcodeTarget"
    @close="transcodeTarget = null"
  />
</template>
