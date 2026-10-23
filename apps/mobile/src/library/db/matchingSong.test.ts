import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { libraryFinder, normalizeTrack, type YtSong } from "@wave/core";
import { loadLibraryStore } from "../../../bench/fastAgain/store.ts";
import { addLibrary, closeTestDatabase, openTestDatabase, traceQueries } from "./testDatabase.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const song: YtSong = {
  videoId: "playing",
  title: "Déjà Vu",
  artists: ["Beyoncé"],
  durationMs: 180000,
  album: null,
  explicit: false,
  artworkUrl: null,
};
const track = (
  title = song.title,
  artist = "Beyoncé",
  durationMs = 180000,
  path = "/Music/playing.m4a",
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

test("targeted playing-song lookup preserves the Library finder's recording identity", async () => {
  const db = await openTestDatabase();
  try {
    addLibrary(db, { tracks: 1000, artists: 40, albums: 100 });
    const store = await loadLibraryStore(root, db);
    Effect.runSync(
      store.saveBatch(
        [
          track("Deja Vu (Live)"),
          track("Deja Vu", "Another Artist", 180000, "/Music/wrong.m4a"),
          track("Deja Vu", "Beyoncé", 220000, "/Music/long.m4a"),
          track("Deja Vu (Remastered 2011)", "Beyoncé feat. Jay-Z", 181000, "/Music/right.m4a"),
        ],
        [],
      ),
    );
    const expected = libraryFinder(Effect.runSync(store.listSongs))(song);
    const measured = traceQueries(db, () => Effect.runSync(store.matchingSong(song)));
    assert.equal(measured.result?.id, expected?.id);
    assert.equal(measured.result?.path, "/Music/right.m4a");
    assert.ok(
      measured.queries.some((q) => q.plan.some((step) => step.includes("tracks_match_title_idx"))),
    );
    assert.ok(measured.queries.reduce((n, q) => n + q.rows, 0) < 10);
    assert.equal(Effect.runSync(store.matchingSong({ ...song, title: "Absent" })), null);
  } finally {
    closeTestDatabase(db);
  }
});

test("an upgraded missing recording keeps its row and star when downloaded, and retags update its lookup key", async () => {
  const { addMissingSong, migrateTestDatabase } = await import("./testDatabase.ts");
  const db = await openTestDatabase({ through: "0036_playlist_recommendation_feedback" });
  try {
    const id = addMissingSong(db, {
      title: "Deja Vu (Remastered 2011)",
      artist: "Beyoncé",
      album: "Record",
      durationMs: 180000,
    });
    await migrateTestDatabase(db);
    const store = await loadLibraryStore(root, db);
    Effect.runSync(store.setFavorites([id], true));
    const missing = Effect.runSync(store.matchingSong(song));
    assert.equal(missing?.id, id);
    assert.equal(missing?.path, null);
    Effect.runSync(store.saveBatch([{ ...track(), fills: id }], []));
    const local = Effect.runSync(store.matchingSong(song));
    assert.equal(local?.id, id);
    assert.equal(local?.path, "/Music/playing.m4a");
    assert.ok(Effect.runSync(store.favoriteTrackIds).includes(id));
    Effect.runSync(store.saveBatch([track("New title")], []));
    assert.equal(Effect.runSync(store.matchingSong(song)), null);
    assert.equal(Effect.runSync(store.matchingSong({ ...song, title: "New title" }))?.id, id);
  } finally {
    closeTestDatabase(db);
  }
});

test("duplicates keep the same Library ordering and video ids never override recording versions", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    Effect.runSync(
      store.saveBatch(
        [
          {
            ...track("Deja Vu (Live)", "Beyoncé", 180000, "/Music/live.m4a"),
            videoId: song.videoId,
          },
          track("Déjà Vu", "Beyoncé", 180000, "/Music/z.m4a"),
          track("Déjà Vu", "Beyoncé", 180000, "/Music/a.m4a"),
        ],
        [],
      ),
    );
    const expected = libraryFinder(Effect.runSync(store.listSongs))(song);
    const found = Effect.runSync(store.matchingSong(song));
    assert.equal(found?.id, expected?.id);
    assert.equal(found?.path, "/Music/a.m4a");
    assert.equal(Effect.runSync(store.matchingSong({ ...song, durationMs: 230000 })), null);
  } finally {
    closeTestDatabase(db);
  }
});
