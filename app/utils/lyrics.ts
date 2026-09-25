/**
 * Music module — lyric parsing (client).
 *
 * Lives on the client because that is where it is used: the API hands back the
 * raw lyric text (embedded tag or a sidecar `.lrc`) and the player decides how to
 * present it. Handles both shapes a real library contains — a timed `.lrc`, and
 * plain text with no timing at all — so the player only renders one shape.
 *
 * Pure functions, unit-tested.
 */

export interface LyricLine {
  /** Seconds from the start; -1 for untimed lyrics. */
  time: number
  text: string
}

export interface ParsedLyrics {
  /** True when at least one line carried a timestamp. */
  synced: boolean
  lines: LyricLine[]
}

/** `[ar:Artist]`, `[offset:500]`, … — metadata, not lyrics. */
const METADATA_TAG = /^\[(ar|ti|al|by|offset|re|ve|length):/i

/** One or more `[mm:ss.xx]` / `[mm:ss]` / `[m:ss.xxx]` timestamps per line. */
const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

/** `[offset:+500]` shifts every timestamp by that many milliseconds. */
function readOffset(text: string): number {
  const match = /\[offset:\s*([+-]?\d+)\s*\]/i.exec(text)
  if (!match) return 0
  const value = Number.parseInt(match[1]!, 10)
  return Number.isFinite(value) ? value / 1000 : 0
}

export function parseLyrics(input: string | null | undefined): ParsedLyrics {
  const source = String(input ?? '').replace(/\r\n?/g, '\n')
  if (!source.trim()) return { synced: false, lines: [] }

  const offset = readOffset(source)
  const synced: LyricLine[] = []
  const plain: LyricLine[] = []

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    if (!line || METADATA_TAG.test(line)) continue

    TIMESTAMP.lastIndex = 0
    const stamps: number[] = []
    let match: RegExpExecArray | null
    let lastIndex = 0
    while ((match = TIMESTAMP.exec(line))) {
      const minutes = Number.parseInt(match[1]!, 10)
      const seconds = Number.parseInt(match[2]!, 10)
      // `[00:12.5]` is 12.5s and `[00:12.50]` is 12.50s — pad to three digits.
      const milliseconds = Number.parseInt((match[3] ?? '0').padEnd(3, '0').slice(0, 3), 10)
      stamps.push(minutes * 60 + seconds + milliseconds / 1000)
      lastIndex = match.index + match[0].length
    }

    if (!stamps.length) {
      plain.push({ time: -1, text: line })
      continue
    }
    const text = line.slice(lastIndex).trim()
    for (const time of stamps) synced.push({ time: Math.max(0, time + offset), text })
  }

  if (!synced.length) return { synced: false, lines: plain }
  // A file can carry both; the timed lines are the ones worth showing.
  return { synced: true, lines: synced.sort((a, b) => a.time - b.time) }
}

/** Index of the line to highlight at `position` seconds; -1 before the first. */
export function activeLyricIndex(lines: LyricLine[], position: number): number {
  if (!lines.length || !Number.isFinite(position)) return -1
  let found = -1
  for (const [index, line] of lines.entries()) {
    if (line.time < 0) continue
    if (line.time <= position) found = index
    else break
  }
  return found
}
