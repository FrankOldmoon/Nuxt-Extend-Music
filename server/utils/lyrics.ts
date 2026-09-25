/**
 * Music module — sidecar lyric lookup.
 *
 * Many libraries keep `song.lrc` next to `song.flac` instead of embedding
 * lyrics; this resolves that neighbour (same directory, same basename, `.lrc`).
 */
import { readFile } from 'node:fs/promises'
import { getAbsolutePath } from '../../../../server/utils/fileStorage'

const MAX_LYRICS_BYTES = 512 * 1024

/** Read `<basename>.lrc` beside a stored audio file; '' when there is none. */
export async function readSidecarLyrics(relativeAudioPath: string): Promise<string> {
  if (!relativeAudioPath) return ''
  try {
    const base = getAbsolutePath(relativeAudioPath).replace(/\.[a-z0-9]+$/i, '')
    for (const candidate of [`${base}.lrc`, `${base}.LRC`]) {
      try {
        const buffer = await readFile(candidate)
        if (buffer.length > 0 && buffer.length <= MAX_LYRICS_BYTES) return buffer.toString('utf8')
      } catch {
        /* try the next candidate */
      }
    }
  } catch {
    /* a missing sidecar is not an error */
  }
  return ''
}
