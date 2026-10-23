import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { libraryFinder, normalizeTrack, type YtSong } from "@wave/core";
import { sql } from "drizzle-orm";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import {
  addLibrary,
  closeTestDatabase,
  openTestDatabase,
  traceQueries,
} from "../library/db/testDatabase.ts";
import { createNowPlayingSongLookup, type PlayingSongTarget } from "../nowPlaying/songLookup.ts";
import { createNowPlayingSongActions } from "../nowPlaying/songActions.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const song: YtSong = {
  videoId: "playing",
  title: "Déjà Vu",
  artists: ["Beyoncé"],
  durationMs: 180000,
  artworkUrl: null,
  album: null,
  explicit: false,
};
const target: PlayingSongTarget = { trackId: "yt:playing", song };
const track = (
  title = "Deja Vu (Remastered 2011)",
  artist = "Beyoncé feat. Jay-Z",
  durationMs = 181000,
  path = "/Music/right.m4a",
) => ({
  ...normalizeTrack({ path, title, artist, album: "Record", durationMs }),
  sizeBytes: 1000,
  modifiedAt: 0,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
  explicit: "unknown" as const,
});

test("actual store: opening starts zero reads; settlement shares one targeted identity/file/star statement", async () => {
  const db = await openTestDatabase();
  try {
    addLibrary(db, { tracks: 1000, artists: 40, albums: 100 });
    const store = await loadLibraryStore(root, db);
    Effect.runSync(store.saveBatch([track()], []));
    const expected = libraryFinder(Effect.runSync(store.listSongs))(song)!;
    Effect.runSync(store.setFavorites([expected.id], true));
    const queries: ReturnType<typeof traceQueries>["queries"][number][] = [];
    const lookup = createNowPlayingSongLookup({
      read: async (captured) => {
        const traced = traceQueries(db, () => Effect.runSync(store.nowPlayingSong(captured)));
        queries.push(...traced.queries);
        return traced.result;
      },
    });
    lookup.update(target, true, false);
    assert.equal(lookup.get(target), undefined);
    await Promise.resolve();
    assert.equal(queries.length, 0);
    lookup.update(target, true, true);
    const answers = await Promise.all([
      lookup.acquire(target),
      lookup.acquire(target),
      lookup.acquire(target),
    ]);
    assert.deepEqual(answers[0], { track: expected, favorite: true, pendingFavorite: false });
    assert.equal(answers[0], answers[1]);
    assert.equal(queries.length, 1);
    assert.equal(queries[0]!.rows, 1);
    assert.ok(queries[0]!.plan.some((step) => step.includes("tracks_match_title_idx")));
  } finally {
    closeTestDatabase(db);
  }
});

test("actual early gestures choose the existing missing song, never create a duplicate stream download, and use saved star state", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    Effect.runSync(store.saveBatch([track()], []));
    const saved = libraryFinder(Effect.runSync(store.listSongs))(song)!;
    db.run(sql`UPDATE tracks SET path = NULL WHERE id = ${saved.id}`);
    Effect.runSync(store.setFavorites([saved.id], true));
    let reads = 0;
    const lookup = createNowPlayingSongLookup({
      read: async (captured) => {
        reads++;
        return Effect.runSync(store.nowPlayingSong(captured));
      },
    });
    const downloads: unknown[] = [];
    const actions = createNowPlayingSongActions(lookup, {
      download: (command) => {
        downloads.push(command);
      },
      starred: (_target, answer) => answer.favorite || answer.pendingFavorite,
      star: (_target, answer, on) => {
        Effect.runSync(store.setFavorites([answer.track!.id], on));
      },
    });
    lookup.update(target, true, false);
    const playlist = actions.playlist(target);
    await Promise.all([actions.download(target), actions.star(target)]);
    assert.deepEqual(await playlist, [{ source: "library", trackId: saved.id }]);
    assert.deepEqual(downloads, [{ kind: "missing", id: saved.id }]);
    assert.equal(reads, 1);
    assert.equal(Effect.runSync(store.nowPlayingSong(target)).favorite, false);
  } finally {
    closeTestDatabase(db);
  }
});

test("targeted state matches the old finder across title variants, duplicate lengths, pending favorites and local/deleted files", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    Effect.runSync(
      store.saveBatch(
        [
          track("Deja Vu (Live)"),
          track("Deja Vu", "Another Artist", 180000, "/Music/wrong.m4a"),
          track("Deja Vu", "Beyoncé", 220000, "/Music/long.m4a"),
          track("Deja Vu (Remastered 2011)", "Beyoncé feat. Jay-Z", 181000, "/Music/matched.m4a"),
        ],
        [],
      ),
    );
    const expected = libraryFinder(Effect.runSync(store.listSongs))(song)!;
    assert.equal(expected.path, "/Music/matched.m4a");
    const streamed = Effect.runSync(store.nowPlayingSong(target));
    assert.deepEqual(streamed, { track: expected, favorite: false, pendingFavorite: false });
    const local = { trackId: String(expected.id), song: null };
    assert.deepEqual(Effect.runSync(store.nowPlayingSong(local)), streamed);
    const absent = { trackId: "yt:absent", song: { ...song, title: "Absent", videoId: "absent" } };
    Effect.runSync(store.addPendingFavorites([absent.song]));
    const measured = traceQueries(db, () => Effect.runSync(store.nowPlayingSong(absent)));
    assert.deepEqual(measured.result, { track: null, favorite: false, pendingFavorite: true });
    assert.equal(measured.queries.length, 1);
    Effect.runSync(store.removeSongs([expected.id]));
    assert.equal(Effect.runSync(store.nowPlayingSong(local)).track, null);
  } finally {
    closeTestDatabase(db);
  }
});
