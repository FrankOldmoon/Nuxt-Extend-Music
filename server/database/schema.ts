/**
 * Music module — Drizzle schema.
 *
 * A Navidrome-style music catalogue. All tables use the `mus_` prefix and live
 * *only* inside this module. They are registered with the host project's generic
 * dashboard CRUD from `server/plugins/music.ts` via `registerDrizzleSchema` +
 * `registerDashboardTable`.
 *
 * Tables:
 *   - mus_artists          Browsable artists (one row per distinct performer).
 *   - mus_albums           Browsable albums, keyed by (name, album artist).
 *   - mus_genres           Flat genre list derived from tags.
 *   - mus_tracks           One audio file per row; the centre of the catalogue.
 *   - mus_playlists        User-curated playlists (may be public).
 *   - mus_playlist_tracks  playlist ↔ track pivot carrying the manual order.
 *   - mus_stars            Per-user stars for tracks / albums / artists.
 *   - mus_play_history     Append-only play log, feeds "recently played".
 *
 * Visibility is a single `is_public` flag on the track: anonymous visitors see
 * the home page and every public track, while uploads/edits/deletes require a
 * signed-in user (the host has no global auth middleware, so this is enforced
 * per handler).
 *
 * There is deliberately no transcode cache table: format conversion runs in the
 * browser through ffmpeg.wasm, so the server never holds a converted copy.
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from 'drizzle-orm/pg-core'

export const musArtists = pgTable('mus_artists',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 500 }).notNull(),
    /** Normalised name used for sorting ("The Beatles" → "beatles, the"). */
    sortName: varchar('sort_name', { length: 500 }),
    cover: varchar('cover', { length: 500 }),
    trackCount: integer('track_count').notNull().default(0),
    albumCount: integer('album_count').notNull().default(0),
    playCount: integer('play_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  t => [
    index('mus_artists_sort_idx').on(t.sortName),
    index('mus_artists_name_idx').on(t.name)
  ]
)

export const musAlbums = pgTable('mus_albums',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 500 }).notNull(),
    sortName: varchar('sort_name', { length: 500 }),
    /** Album artist; nullable for "unknown" so the row can be kept public. */
    artistId: integer('artist_id').references(() => musArtists.id, { onDelete: 'set null' }),
    year: integer('year'),
    cover: varchar('cover', { length: 500 }),
    trackCount: integer('track_count').notNull().default(0),
    /** Total runtime in seconds. */
    duration: doublePrecision('duration').notNull().default(0),
    playCount: integer('play_count').notNull().default(0),
    isCompilation: boolean('is_compilation').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  t => [
    index('mus_albums_artist_idx').on(t.artistId),
    index('mus_albums_sort_idx').on(t.sortName)
  ]
)

export const musGenres = pgTable('mus_genres',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 220 }).notNull().unique(),
    trackCount: integer('track_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  t => [
    index('mus_genres_slug_idx').on(t.slug)
  ]
)

export const musTracks = pgTable('mus_tracks',
  {
    id: serial('id').primaryKey(),
    title: varchar('title', { length: 500 }).notNull(),
    artistId: integer('artist_id').references(() => musArtists.id, { onDelete: 'set null' }),
    /** Album artist, kept separately so compilations do not split an album. */
    albumArtistId: integer('album_artist_id').references(() => musArtists.id, { onDelete: 'set null' }),
    albumId: integer('album_id').references(() => musAlbums.id, { onDelete: 'set null' }),
    genreId: integer('genre_id').references(() => musGenres.id, { onDelete: 'set null' }),
    trackNo: integer('track_no'),
    discNo: integer('disc_no'),
    year: integer('year'),
    /** Runtime in seconds, parsed from the container (not estimated on demand). */
    duration: doublePrecision('duration').notNull().default(0),
    bitrate: integer('bitrate'),
    sampleRate: integer('sample_rate'),
    channels: integer('channels'),
    format: varchar('format', { length: 16 }).notNull(),
    size: integer('size').notNull().default(0),
    /** Content hash — makes re-uploading the same audio idempotent. */
    hash: varchar('hash', { length: 64 }).notNull(),
    path: varchar('path', { length: 500 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }),
    /** Track-level art; null means "inherit the album's cover". */
    cover: varchar('cover', { length: 500 }),
    /** Embedded lyrics (USLT / LYRICS), null when the file carries none. */
    lyrics: text('lyrics'),
    playCount: integer('play_count').notNull().default(0),
    lastPlayedAt: timestamp('last_played_at', { withTimezone: true }),
    isPublic: boolean('is_public').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    userId: integer('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  t => [
    index('mus_tracks_artist_idx').on(t.artistId),
    index('mus_tracks_album_artist_idx').on(t.albumArtistId),
    index('mus_tracks_album_idx').on(t.albumId),
    index('mus_tracks_genre_idx').on(t.genreId),
    index('mus_tracks_hash_idx').on(t.hash),
    index('mus_tracks_created_idx').on(t.createdAt),
    index('mus_tracks_title_idx').on(t.title)
  ]
)

export const musPlaylists = pgTable('mus_playlists',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 300 }).notNull(),
    description: text('description'),
    cover: varchar('cover', { length: 500 }),
    isPublic: boolean('is_public').notNull().default(true),
    userId: integer('user_id'),
    trackCount: integer('track_count').notNull().default(0),
    duration: doublePrecision('duration').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
  },
  t => [
    index('mus_playlists_user_idx').on(t.userId)
  ]
)

export const musPlaylistTracks = pgTable('mus_playlist_tracks',
  {
    id: serial('id').primaryKey(),
    playlistId: integer('playlist_id').notNull().references(() => musPlaylists.id, { onDelete: 'cascade' }),
    trackId: integer('track_id').notNull().references(() => musTracks.id, { onDelete: 'cascade' }),
    /** Manual running order inside the playlist. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => [
    uniqueIndex('mus_playlist_tracks_pair_idx').on(t.playlistId, t.trackId),
    index('mus_playlist_tracks_order_idx').on(t.playlistId, t.sortOrder)
  ]
)

export const musStars = pgTable('mus_stars',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    /** track | album | artist */
    entityType: varchar('entity_type', { length: 16 }).notNull(),
    entityId: integer('entity_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => [
    uniqueIndex('mus_stars_pair_idx').on(t.userId, t.entityType, t.entityId),
    index('mus_stars_entity_idx').on(t.entityType, t.entityId)
  ]
)

export const musPlayHistory = pgTable('mus_play_history',
  {
    id: serial('id').primaryKey(),
    trackId: integer('track_id').notNull().references(() => musTracks.id, { onDelete: 'cascade' }),
    /** Null for anonymous listeners. */
    userId: integer('user_id'),
    /** How much of the track was actually heard, in milliseconds. */
    msPlayed: integer('ms_played').notNull().default(0),
    playedAt: timestamp('played_at', { withTimezone: true }).notNull().defaultNow()
  },
  t => [
    index('mus_play_history_track_idx').on(t.trackId),
    index('mus_play_history_played_idx').on(t.playedAt)
  ]
)
