/**
 * Music module — HTTP byte-range support for audio streaming.
 *
 * Seeking only works when the server honours `Range` requests; a browser that
 * cannot issue one has to download the whole file before it will let you scrub.
 * The parsing is a pure function so the edge cases (open-ended ranges, suffix
 * ranges, ranges past the end, multi-range requests) are unit-tested.
 */

export interface ByteRange {
  /** Inclusive first byte. */
  start: number
  /** Inclusive last byte. */
  end: number
}

/**
 * Resolve a `Range` header against a known length.
 *
 * Returns null when the header is absent, malformed, multi-range or entirely
 * outside the file — in which case the caller should send the whole body as
 * `200 OK`, which is what RFC 9110 prescribes for an unsatisfiable range.
 */
export function parseRangeHeader(header: string | undefined | null, size: number): ByteRange | null {
  if (!header || size <= 0) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  if (rawStart === '') {
    // `bytes=-500` — the final 500 bytes.
    const length = Number.parseInt(rawEnd!, 10)
    if (!Number.isFinite(length) || length <= 0) return null
    return { start: Math.max(0, size - length), end: size - 1 }
  }

  const start = Number.parseInt(rawStart!, 10)
  if (!Number.isFinite(start) || start >= size) return null

  if (rawEnd === '') return { start, end: size - 1 }

  const end = Number.parseInt(rawEnd!, 10)
  if (!Number.isFinite(end) || end < start) return null
  return { start, end: Math.min(end, size - 1) }
}

/** `Content-Range` value for a 206 response. */
export function contentRangeHeader(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`
}

/** Length of a range in bytes (inclusive bounds). */
export function rangeLength(range: ByteRange): number {
  return range.end - range.start + 1
}
