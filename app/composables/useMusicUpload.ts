/**
 * Music module — shared upload-dialog state.
 *
 * The upload entry point belongs on the pages that need it (the home hero, the
 * all-tracks toolbar) while the dialog itself is rendered once by the layout, so
 * the open flag has to be shared rather than passed down. A module-scope ref,
 * like the player's state.
 */
const open = ref(false)

export function useMusicUpload() {
  return {
    open: readonly(open),
    openUpload: (): void => {
      open.value = true
    },
    closeUpload: (): void => {
      open.value = false
    }
  }
}
