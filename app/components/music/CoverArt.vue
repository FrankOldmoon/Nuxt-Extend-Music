<script setup lang="ts">
/**
 * Cover art with a graceful fallback.
 *
 * Album/artist artwork in a real library is frequently missing, so the fallback
 * is a first-class state rather than an error: a music glyph in the placeholder.
 */
const props = withDefaults(defineProps<{
  src?: string | null
  name?: string | null
  /** Fixed square size, or `fill` to stretch to the parent (grids). */
  size?: 'sm' | 'md' | 'lg'
  fill?: boolean
  rounded?: 'md' | 'full'
}>(), {
  src: null,
  name: null,
  size: 'md',
  fill: false,
  rounded: 'md'
})

const sizeClass = computed(() => {
  if (props.fill) return 'w-full aspect-square'
  return props.size === 'sm' ? 'size-9' : props.size === 'lg' ? 'size-40' : 'size-12'
})
</script>

<template>
  <div
    :class="[
      sizeClass,
      rounded === 'full' ? 'rounded-full' : 'rounded-lg',
      'relative shrink-0 overflow-hidden bg-elevated'
    ]"
  >
    <img
      v-if="src"
      :src="src"
      :alt="name ?? ''"
      loading="lazy"
      class="size-full object-cover"
    >
    <div
      v-else
      class="flex size-full items-center justify-center text-muted"
    >
      <UIcon
        name="i-lucide-music"
        class="size-1/2"
      />
    </div>
  </div>
</template>
