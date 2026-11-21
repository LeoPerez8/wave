/**
 * Migration `0069_kept_play_totals` (#1349): the tables and triggers that keep
 * every song's counted plays, and each album's, artist's and song's they
 * count for, summed per UTC day and per block of 32 days (Core's
 * `playBuckets`), so a window's totals read a few rows (`keptPlayTotals.ts`).
 *
 * - `played_songs`: one row per song plays are of, by key: `t:<track id>` for
 *   a Library song's plays, `v:<video id>|<recording key>` for streamed ones,
 *   `r:<recording key>` for a synced play with neither. Its `state` says what
 *   is still owed: 0 its buckets (plays from before this migration), 1 its
 *   credits, 2 nothing.
 * - `play_buckets`: each song's counted plays, time and latest counted start
 *   per day (`span` 0) and block (`span` 1). Triggers on `play_events` keep it
 *   as the play is written: an insert or a growing play adds to it, any other
 *   change sums that day and block again from the plays.
 * - `play_credits`: what a song's plays count for (`kind` album, artist,
 *   credit or song, `entity` its id), each `weight` times. The app writes it
 *   (`settleKeptTotals`), since a streamed song's credits are Core's.
 * - `credited_buckets`: `play_buckets` summed per credit, which triggers on
 *   the two tables above keep.
 * - `played_recordings`: each recording key's counted plays, for the
 *   new-release feed. Its triggers count only plays already seeded or newer
 *   than the migration, so a seeding step adds each older play once.
 * - `playlist_play_buckets`: each playlist's counted plays (by play context
 *   id) and latest counted start per day and block, counted the same way.
 *
 * The migration itself reads no history: `seed_until` is the last play it
 * found, and the app seeds and sums the songs of the plays up to it in
 * bounded steps after startup. Library changes mark the songs whose credits
 * they may change as owed (state 1); a change to what Core matches streamed
 * songs against marks every streamed song the Library hasn't and bumps
 * `generation`.
 */

const DAY_MS = 86_400_000;
const BLOCK_MS = 32 * DAY_MS;

/** The key of the song the play [row] is of. */
export const songKeySql = (row: string) => `(CASE
  WHEN ${row}.track_id IS NOT NULL THEN 't:' || ${row}.track_id
  WHEN ${row}.video_id IS NOT NULL THEN 'v:' || ${row}.video_id || '|' || coalesce(${row}.recording_key, '')
  ELSE 'r:' || ${row}.recording_key END)`;

const spans = (row: string) => [
  { span: 0, bucket: `${row}.started_at / ${DAY_MS}`, size: DAY_MS },
  { span: 1, bucket: `${row}.started_at / ${BLOCK_MS}`, size: BLOCK_MS },
];

const ADD_BUCKET = `ON CONFLICT (song, span, bucket) DO UPDATE SET
    counted_plays = counted_plays + excluded.counted_plays,
    listened_ms = listened_ms + excluded.listened_ms,
    latest_play_at = max(latest_play_at, excluded.latest_play_at)`;

const ADD_CREDITED = `ON CONFLICT (kind, span, bucket, entity) DO UPDATE SET
    counted_plays = counted_plays + excluded.counted_plays,
    listened_ms = listened_ms + excluded.listened_ms,
    latest_play_at = max(latest_play_at, excluded.latest_play_at)`;

/** Adds [plays] counted plays of [row] (its time [listened]) to its day and block. */
const addPlay = (row: string, plays: string, listened: string) => `
  INSERT INTO play_buckets (song, span, bucket, counted_plays, listened_ms, latest_play_at)
    VALUES ${spans(row)
      .map(
        ({ span, bucket }) =>
          `(${songKeySql(row)}, ${span}, ${bucket}, ${plays}, ${listened}, ${row}.started_at)`,
      )
      .join(", ")}
    ${ADD_BUCKET};`;

/** Sums the day and block of the play [row] again from its song's counted plays. */
const sumAgain = (row: string) =>
  spans(row)
    .map(
      ({ span, bucket, size }) => `
  DELETE FROM play_buckets WHERE song = ${songKeySql(row)} AND span = ${span} AND bucket = ${bucket};
  INSERT INTO play_buckets (song, span, bucket, counted_plays, listened_ms, latest_play_at)
    SELECT ${songKeySql(row)}, ${span}, ${bucket}, count(*), sum(e.listened_ms), max(e.started_at)
    FROM play_events AS e
    WHERE e.counted AND e.started_at BETWEEN (${bucket}) * ${size} AND (${bucket}) * ${size} + ${size - 1}
      AND ${songKeySql("e")} = ${songKeySql(row)}
    GROUP BY 1;`,
    )
    .join("");

/** The plays of a song in the same day can only add: listened longer, or counted now. */
const GROWS = `${songKeySql("old")} = ${songKeySql("new")} AND old.started_at = new.started_at
  AND new.counted AND (NOT old.counted OR new.listened_ms >= old.listened_ms)`;

/** Sums the credited buckets of [song]'s credits in one [span] and [bucket] again. */
const creditAgain = (song: string, span: string, bucket: string) => `
  DELETE FROM credited_buckets WHERE span = ${span} AND bucket = ${bucket}
    AND (kind, entity) IN (SELECT kind, entity FROM play_credits WHERE song = ${song});
  INSERT INTO credited_buckets (kind, entity, span, bucket, counted_plays, listened_ms, latest_play_at)
    SELECT c.kind, c.entity, ${span}, ${bucket}, sum(c.weight * p.counted_plays),
      sum(c.weight * p.listened_ms), max(p.latest_play_at)
    FROM play_credits AS c
    JOIN play_buckets AS p ON p.song = c.song AND p.span = ${span} AND p.bucket = ${bucket}
    WHERE (c.kind, c.entity) IN (SELECT kind, entity FROM play_credits WHERE song = ${song})
    GROUP BY c.kind, c.entity;`;

/** Marks the songs [where] selects as owing their credits. */
const owe = (where: string) => `UPDATE played_songs SET state = 1 WHERE state = 2 AND (${where});`;

/** What Core matches streamed songs against changed: every streamed song the Library hasn't owes. */
const ONLINE_CHANGED = `${owe("online = 1")}
  UPDATE kept_totals_state SET generation = generation + 1;`;

const PLAY_COLUMNS = "track_id, video_id, recording_key, started_at, listened_ms, counted";

/** Whether the play [id] is counted in `played_recordings` yet: newer than the migration, or seeded. */
const accounted = (id: string) => `(${id} > (SELECT seed_until FROM kept_totals_state)
  OR ${id} <= (SELECT seeded_through FROM kept_totals_state))`;

/** Whether the play [row] was counted from a playlist. */
const fromPlaylist = (row: string) =>
  `(${row}.counted AND ${row}.context_type = 'playlist' AND ${row}.context_id IS NOT NULL)`;

/** Adds the playlist play [row], when it is one, to its playlist's day and block. */
const addPlaylistPlay = (row: string) => `
  INSERT INTO playlist_play_buckets (context_id, span, bucket, counted_plays, latest_play_at)
    SELECT * FROM (${spans(row)
      .map(
        ({ span, bucket }) => `SELECT ${row}.context_id, ${span}, ${bucket}, 1, ${row}.started_at`,
      )
      .join(" UNION ALL ")}) WHERE ${fromPlaylist(row)}
    ON CONFLICT (context_id, span, bucket) DO UPDATE SET counted_plays = counted_plays + 1,
      latest_play_at = max(latest_play_at, excluded.latest_play_at);`;

/** Takes the playlist play [row], when it was one, out of its day and block, finding their latest again. */
const removePlaylistPlay = (row: string) =>
  spans(row)
    .map(
      ({ span, bucket, size }) => `
  UPDATE playlist_play_buckets SET counted_plays = counted_plays - 1,
    latest_play_at = (SELECT max(e.started_at) FROM play_events AS e
      WHERE e.context_type = 'playlist' AND e.context_id = ${row}.context_id AND e.counted
        AND e.started_at BETWEEN (${bucket}) * ${size} AND (${bucket}) * ${size} + ${size - 1})
  WHERE ${fromPlaylist(row)} AND context_id = ${row}.context_id AND span = ${span} AND bucket = ${bucket};`,
    )
    .join("");

/** Adds [plays] counted plays to the recording [key]. */
const countRecording = (key: string, plays: string) => `
  INSERT INTO played_recordings (recording_key, counted_plays) SELECT ${key}, ${plays}
    WHERE ${key} IS NOT NULL AND ${plays} <> 0
    ON CONFLICT (recording_key) DO UPDATE SET counted_plays = counted_plays + excluded.counted_plays;`;

export const mKeptPlayTotals = `CREATE TABLE played_songs (
	song text PRIMARY KEY NOT NULL,
	track_id integer,
	video_id text,
	recording_key text,
	state integer NOT NULL,
	song_track integer,
	online integer DEFAULT 0 NOT NULL,
	album_hint text
);
--> statement-breakpoint
CREATE INDEX played_songs_state_idx ON played_songs (state);
--> statement-breakpoint
CREATE INDEX played_songs_track_idx ON played_songs (track_id);
--> statement-breakpoint
CREATE INDEX played_songs_video_idx ON played_songs (video_id);
--> statement-breakpoint
CREATE INDEX played_songs_recording_idx ON played_songs (recording_key);
--> statement-breakpoint
CREATE INDEX played_songs_song_track_idx ON played_songs (song_track);
--> statement-breakpoint
CREATE INDEX played_songs_online_idx ON played_songs (online, state);
--> statement-breakpoint
CREATE INDEX played_songs_album_hint_idx ON played_songs (album_hint);
--> statement-breakpoint
CREATE TABLE play_buckets (
	song text NOT NULL,
	span integer NOT NULL,
	bucket integer NOT NULL,
	counted_plays integer NOT NULL,
	listened_ms integer NOT NULL,
	latest_play_at integer NOT NULL,
	PRIMARY KEY (song, span, bucket)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE play_credits (
	song text NOT NULL,
	kind text NOT NULL,
	entity text NOT NULL,
	weight integer NOT NULL,
	album_id integer,
	artist_id integer,
	PRIMARY KEY (song, kind, entity)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX play_credits_entity_idx ON play_credits (kind, entity);
--> statement-breakpoint
CREATE INDEX play_credits_album_idx ON play_credits (album_id);
--> statement-breakpoint
CREATE INDEX play_credits_artist_idx ON play_credits (artist_id);
--> statement-breakpoint
CREATE TABLE credited_buckets (
	kind text NOT NULL,
	entity text NOT NULL,
	span integer NOT NULL,
	bucket integer NOT NULL,
	counted_plays integer NOT NULL,
	listened_ms integer NOT NULL,
	latest_play_at integer NOT NULL,
	PRIMARY KEY (kind, span, bucket, entity)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE played_entities (
	kind text NOT NULL,
	entity text NOT NULL,
	sort_key text NOT NULL,
	item text NOT NULL,
	played_at integer NOT NULL,
	PRIMARY KEY (kind, entity)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE played_recordings (
	recording_key text PRIMARY KEY NOT NULL,
	counted_plays integer NOT NULL
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE playlist_play_buckets (
	context_id text NOT NULL,
	span integer NOT NULL,
	bucket integer NOT NULL,
	counted_plays integer NOT NULL,
	latest_play_at integer,
	PRIMARY KEY (context_id, span, bucket)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX playlist_play_buckets_bucket_idx ON playlist_play_buckets (span, bucket);
--> statement-breakpoint
CREATE TABLE kept_totals_state (
	id integer PRIMARY KEY NOT NULL CHECK (id = 1),
	generation integer NOT NULL,
	seeded_through integer NOT NULL,
	seed_until integer NOT NULL
);
--> statement-breakpoint
INSERT INTO kept_totals_state (id, generation, seeded_through, seed_until)
	VALUES (1, 0, 0, coalesce((SELECT max(id) FROM play_events), 0));
--> statement-breakpoint
CREATE TRIGGER kept_song_insert AFTER INSERT ON play_events BEGIN
  INSERT INTO played_songs (song, track_id, video_id, recording_key, state)
    VALUES (${songKeySql("new")}, new.track_id, new.video_id, new.recording_key, 1)
    ON CONFLICT (song) DO UPDATE SET state = 1 WHERE state = 2 AND excluded.video_id IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER kept_song_change AFTER UPDATE OF track_id, video_id, recording_key ON play_events
WHEN ${songKeySql("old")} <> ${songKeySql("new")} BEGIN
  INSERT INTO played_songs (song, track_id, video_id, recording_key, state)
    VALUES (${songKeySql("new")}, new.track_id, new.video_id, new.recording_key, 1)
    ON CONFLICT (song) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER kept_play_insert AFTER INSERT ON play_events WHEN new.counted BEGIN
${addPlay("new", "1", "new.listened_ms")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_play_grow AFTER UPDATE OF ${PLAY_COLUMNS} ON play_events WHEN ${GROWS} BEGIN
${addPlay(
  "new",
  "CASE WHEN old.counted THEN 0 ELSE 1 END",
  "new.listened_ms - CASE WHEN old.counted THEN old.listened_ms ELSE 0 END",
)}
END;
--> statement-breakpoint
CREATE TRIGGER kept_play_change AFTER UPDATE OF ${PLAY_COLUMNS} ON play_events
WHEN (old.counted OR new.counted) AND NOT (${GROWS}) BEGIN
${sumAgain("old")}
${sumAgain("new")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_play_delete AFTER DELETE ON play_events WHEN old.counted BEGIN
${sumAgain("old")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_recording_insert AFTER INSERT ON play_events WHEN new.counted BEGIN
${countRecording("new.recording_key", "1")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_recording_change AFTER UPDATE OF recording_key, counted ON play_events
WHEN ${accounted("new.id")} BEGIN
${countRecording("old.recording_key", "-old.counted")}
${countRecording("new.recording_key", "new.counted")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_recording_delete AFTER DELETE ON play_events
WHEN old.counted AND ${accounted("old.id")} BEGIN
${countRecording("old.recording_key", "-1")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_playlist_insert AFTER INSERT ON play_events WHEN ${fromPlaylist("new")} BEGIN
${addPlaylistPlay("new")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_playlist_change
AFTER UPDATE OF context_type, context_id, started_at, counted ON play_events
WHEN ${accounted("new.id")} AND (${fromPlaylist("old")} OR ${fromPlaylist("new")}) BEGIN
${removePlaylistPlay("old")}
${addPlaylistPlay("new")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_playlist_delete AFTER DELETE ON play_events
WHEN ${fromPlaylist("old")} AND ${accounted("old.id")} BEGIN
${removePlaylistPlay("old")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_play_album AFTER UPDATE OF album_id ON play_events
WHEN new.track_id IS NOT NULL BEGIN
  ${owe("song = 't:' || new.track_id")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_bucket_insert AFTER INSERT ON play_buckets BEGIN
  INSERT INTO credited_buckets (kind, entity, span, bucket, counted_plays, listened_ms, latest_play_at)
    SELECT kind, entity, new.span, new.bucket, weight * new.counted_plays, weight * new.listened_ms,
      new.latest_play_at
    FROM play_credits WHERE song = new.song
    ${ADD_CREDITED};
END;
--> statement-breakpoint
CREATE TRIGGER kept_bucket_grow AFTER UPDATE ON play_buckets
WHEN new.counted_plays >= old.counted_plays AND new.listened_ms >= old.listened_ms
  AND new.latest_play_at >= old.latest_play_at BEGIN
  INSERT INTO credited_buckets (kind, entity, span, bucket, counted_plays, listened_ms, latest_play_at)
    SELECT kind, entity, new.span, new.bucket, weight * (new.counted_plays - old.counted_plays),
      weight * (new.listened_ms - old.listened_ms), new.latest_play_at
    FROM play_credits WHERE song = new.song
    ${ADD_CREDITED};
END;
--> statement-breakpoint
CREATE TRIGGER kept_bucket_change AFTER UPDATE ON play_buckets
WHEN NOT (new.counted_plays >= old.counted_plays AND new.listened_ms >= old.listened_ms
  AND new.latest_play_at >= old.latest_play_at) BEGIN
${creditAgain("new.song", "new.span", "new.bucket")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_bucket_delete AFTER DELETE ON play_buckets BEGIN
${creditAgain("old.song", "old.span", "old.bucket")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_credit_insert AFTER INSERT ON play_credits BEGIN
  INSERT INTO credited_buckets (kind, entity, span, bucket, counted_plays, listened_ms, latest_play_at)
    SELECT new.kind, new.entity, span, bucket, new.weight * counted_plays, new.weight * listened_ms,
      latest_play_at
    FROM play_buckets WHERE song = new.song
    ${ADD_CREDITED};
END;
--> statement-breakpoint
CREATE TRIGGER kept_credit_delete AFTER DELETE ON play_credits BEGIN
  DELETE FROM credited_buckets WHERE kind = old.kind AND entity = old.entity
    AND (span, bucket) IN (SELECT span, bucket FROM play_buckets WHERE song = old.song);
  INSERT INTO credited_buckets (kind, entity, span, bucket, counted_plays, listened_ms, latest_play_at)
    SELECT old.kind, old.entity, p.span, p.bucket, sum(c.weight * p.counted_plays),
      sum(c.weight * p.listened_ms), max(p.latest_play_at)
    FROM play_credits AS c JOIN play_buckets AS p ON p.song = c.song
    WHERE c.kind = old.kind AND c.entity = old.entity
      AND (p.span, p.bucket) IN (SELECT span, bucket FROM play_buckets WHERE song = old.song)
    GROUP BY p.span, p.bucket;
END;
--> statement-breakpoint
CREATE TRIGGER kept_track_insert AFTER INSERT ON tracks BEGIN
  ${owe(`song_track IS NULL AND song NOT LIKE 't:%'
    AND (video_id = new.video_id OR recording_key = new.recording_key)`)}
  ${owe("video_id = new.video_id")}
  ${ONLINE_CHANGED}
END;
--> statement-breakpoint
CREATE TRIGGER kept_track_delete AFTER DELETE ON tracks BEGIN
  ${owe("song = 't:' || old.id")}
  ${owe("song_track = old.id")}
  ${ONLINE_CHANGED}
END;
--> statement-breakpoint
CREATE TRIGGER kept_track_change
AFTER UPDATE OF album_id, artist_id, artist_credit, artist_credits, video_id, recording_key ON tracks BEGIN
  ${owe("song = 't:' || new.id")}
  ${owe("song_track = new.id")}
  ${owe("video_id IN (old.video_id, new.video_id)")}
  ${owe("recording_key IN (old.recording_key, new.recording_key)")}
  ${ONLINE_CHANGED}
END;
--> statement-breakpoint
CREATE TRIGGER kept_track_artist_insert AFTER INSERT ON track_artists BEGIN
  ${owe("song = 't:' || new.track_id")}
  ${owe("song_track = new.track_id")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_track_artist_change AFTER UPDATE ON track_artists BEGIN
  ${owe("song IN ('t:' || old.track_id, 't:' || new.track_id)")}
  ${owe("song_track IN (old.track_id, new.track_id)")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_track_artist_delete AFTER DELETE ON track_artists BEGIN
  ${owe("song = 't:' || old.track_id")}
  ${owe("song_track = old.track_id")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_deleted_artist_insert AFTER INSERT ON deleted_track_artists BEGIN
  ${owe("song = 't:' || new.track_id")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_deleted_artist_delete AFTER DELETE ON deleted_track_artists BEGIN
  ${owe("song = 't:' || old.track_id")}
END;
--> statement-breakpoint
CREATE TRIGGER kept_artist_insert AFTER INSERT ON artists BEGIN
  ${ONLINE_CHANGED}
END;
--> statement-breakpoint
CREATE TRIGGER kept_artist_change AFTER UPDATE OF name, sort ON artists BEGIN
  ${ONLINE_CHANGED}
END;
--> statement-breakpoint
CREATE TRIGGER kept_artist_delete AFTER DELETE ON artists BEGIN
  ${owe("song IN (SELECT song FROM play_credits WHERE artist_id = old.id)")}
  ${ONLINE_CHANGED}
END;
--> statement-breakpoint
CREATE TRIGGER kept_album_insert AFTER INSERT ON albums BEGIN
  ${ONLINE_CHANGED}
END;
--> statement-breakpoint
CREATE TRIGGER kept_album_change
AFTER UPDATE OF title, title_sort, album_artist_id, album_artist_credit, album_artist_credits ON albums BEGIN
  ${ONLINE_CHANGED}
END;
--> statement-breakpoint
CREATE TRIGGER kept_album_delete AFTER DELETE ON albums BEGIN
  ${owe("song IN (SELECT song FROM play_credits WHERE album_id = old.id)")}
  ${ONLINE_CHANGED}
END;
--> statement-breakpoint
CREATE TRIGGER kept_album_artist_insert AFTER INSERT ON album_artists BEGIN
  ${ONLINE_CHANGED}
END;
--> statement-breakpoint
CREATE TRIGGER kept_album_artist_delete AFTER DELETE ON album_artists BEGIN
  ${ONLINE_CHANGED}
END;`;
