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
