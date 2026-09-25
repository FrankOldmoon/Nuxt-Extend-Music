/**
 * Music module — request parsing helpers shared by the route handlers.
 */

export interface Pagination {
  page: number
  pageSize: number
  limit: number
  offset: number
}

/** Clamp `page` / `pageSize` so a hostile query string cannot ask for everything. */
export function pagination(query: Record<string, unknown>, defaultSize = 50, maxSize = 200): Pagination {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1)
  const requested = Number.parseInt(String(query.pageSize ?? defaultSize), 10) || defaultSize
  const pageSize = Math.min(Math.max(1, requested), maxSize)
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize }
}

/** A positive integer query param, or null. */
export function intParam(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** `1` / `true` / `yes` → true. */
export function boolParam(value: unknown): boolean {
  const raw = String(value ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

/** A trimmed string param, or null when empty. */
export function textParam(value: unknown, maxLength = 500): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  return raw.slice(0, maxLength)
}

/** Escape the wildcards in a user-supplied LIKE pattern. */
export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`
}
