/**
 * Music module — database migrations.
 *
 * Self-contained idempotent DDL against the shared host connection, mirroring
 * the library module. Every statement is guarded with `IF NOT EXISTS` /
 * `ADD COLUMN IF NOT EXISTS`, so it can run on every boot as an upgrade path.
 *
 * The `pool` comes from the host project (imported via a path into the host's
 * server/ directory) — the module reuses the host connection, it never opens
 * its own.
 */
import { pool } from '../../../../server/database'

const DDL = `
CREATE TABLE IF NOT EXISTS mus_artists (
  id          serial PRIMARY KEY,
  name        varchar(500) NOT NULL,
  sort_name   varchar(500),
  cover       varchar(500),
  track_count integer      NOT NULL DEFAULT 0,
  album_count integer      NOT NULL DEFAULT 0,
  play_count  integer      NOT NULL DEFAULT 0,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS mus_artists_sort_idx ON mus_artists (sort_name);
CREATE INDEX IF NOT EXISTS mus_artists_name_idx ON mus_artists (name);

CREATE TABLE IF NOT EXISTS mus_albums (
  id             serial PRIMARY KEY,
  name           varchar(500) NOT NULL,
  sort_name      varchar(500),
  artist_id      integer REFERENCES mus_artists(id) ON DELETE SET NULL,
  year           integer,
  cover          varchar(500),
  track_count    integer      NOT NULL DEFAULT 0,
  duration       double precision NOT NULL DEFAULT 0,
  play_count     integer      NOT NULL DEFAULT 0,
  is_compilation boolean      NOT NULL DEFAULT false,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX IF NOT EXISTS mus_albums_artist_idx ON mus_albums (artist_id);
CREATE INDEX IF NOT EXISTS mus_albums_sort_idx   ON mus_albums (sort_name);

CREATE TABLE IF NOT EXISTS mus_genres (
  id          serial PRIMARY KEY,
  name        varchar(200) NOT NULL,
  slug        varchar(220) NOT NULL UNIQUE,
  track_count integer      NOT NULL DEFAULT 0,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS mus_genres_slug_idx ON mus_genres (slug);

CREATE TABLE IF NOT EXISTS mus_tracks (
  id              serial PRIMARY KEY,
  title           varchar(500) NOT NULL,
  artist_id       integer REFERENCES mus_artists(id) ON DELETE SET NULL,
  album_artist_id integer REFERENCES mus_artists(id) ON DELETE SET NULL,
  album_id        integer REFERENCES mus_albums(id) ON DELETE SET NULL,
  genre_id        integer REFERENCES mus_genres(id) ON DELETE SET NULL,
  track_no        integer,
  disc_no         integer,
  year            integer,
  duration        double precision NOT NULL DEFAULT 0,
  bitrate         integer,
  sample_rate     integer,
  channels        integer,
  format          varchar(16)  NOT NULL,
  size            integer      NOT NULL DEFAULT 0,
  hash            varchar(64)  NOT NULL,
  path            varchar(500) NOT NULL,
  original_name   varchar(255) NOT NULL,
  mime_type       varchar(120),
  cover           varchar(500),
  lyrics          text,
  play_count      integer      NOT NULL DEFAULT 0,
  last_played_at  timestamptz,
  is_public       boolean      NOT NULL DEFAULT true,
  is_active       boolean      NOT NULL DEFAULT true,
  user_id         integer,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX IF NOT EXISTS mus_tracks_artist_idx       ON mus_tracks (artist_id);
CREATE INDEX IF NOT EXISTS mus_tracks_album_artist_idx ON mus_tracks (album_artist_id);
CREATE INDEX IF NOT EXISTS mus_tracks_album_idx        ON mus_tracks (album_id);
CREATE INDEX IF NOT EXISTS mus_tracks_genre_idx        ON mus_tracks (genre_id);
CREATE INDEX IF NOT EXISTS mus_tracks_hash_idx         ON mus_tracks (hash);
CREATE INDEX IF NOT EXISTS mus_tracks_created_idx      ON mus_tracks (created_at);
CREATE INDEX IF NOT EXISTS mus_tracks_title_idx        ON mus_tracks (title);

CREATE TABLE IF NOT EXISTS mus_playlists (
  id          serial PRIMARY KEY,
  name        varchar(300) NOT NULL,
  description text,
  cover       varchar(500),
  is_public   boolean      NOT NULL DEFAULT true,
  user_id     integer,
  track_count integer      NOT NULL DEFAULT 0,
  duration    double precision NOT NULL DEFAULT 0,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS mus_playlists_user_idx ON mus_playlists (user_id);

CREATE TABLE IF NOT EXISTS mus_playlist_tracks (
  id          serial PRIMARY KEY,
  playlist_id integer NOT NULL REFERENCES mus_playlists(id) ON DELETE CASCADE,
  track_id    integer NOT NULL REFERENCES mus_tracks(id) ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mus_playlist_tracks_pair_idx  ON mus_playlist_tracks (playlist_id, track_id);
CREATE INDEX IF NOT EXISTS        mus_playlist_tracks_order_idx ON mus_playlist_tracks (playlist_id, sort_order);

CREATE TABLE IF NOT EXISTS mus_stars (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL,
  entity_type varchar(16) NOT NULL,
  entity_id   integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mus_stars_pair_idx   ON mus_stars (user_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS        mus_stars_entity_idx ON mus_stars (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS mus_play_history (
  id         serial PRIMARY KEY,
  track_id   integer NOT NULL REFERENCES mus_tracks(id) ON DELETE CASCADE,
  user_id    integer,
  ms_played  integer NOT NULL DEFAULT 0,
  played_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mus_play_history_track_idx  ON mus_play_history (track_id);
CREATE INDEX IF NOT EXISTS mus_play_history_played_idx ON mus_play_history (played_at);
`

/**
 * Additive upgrades for tables that already exist in a running installation.
 * Every statement is idempotent, so this is safe on each boot.
 */
const UPGRADES = `
ALTER TABLE mus_tracks ADD COLUMN IF NOT EXISTS lyrics text;
ALTER TABLE mus_tracks ADD COLUMN IF NOT EXISTS cover varchar(500);
ALTER TABLE mus_albums ADD COLUMN IF NOT EXISTS is_compilation boolean NOT NULL DEFAULT false;
`

/**
 * Apply the music schema (idempotent). Safe to call on every server boot.
 */
export async function runMusicMigrations(): Promise<void> {
  await pool.query(DDL)
  await pool.query(UPGRADES)
}
