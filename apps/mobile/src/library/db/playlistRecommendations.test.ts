import { eq, sql } from "drizzle-orm";
import * as schema from "./schema.ts";
import { setFavorites } from "./playHistory.ts";
import { addPendingFavorites } from "./pendingFavorites.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { playlistRecommendations, playlistRecommendationSession } from "@wave/core";
import { tasteHistory } from "./taste.ts";
import {
  addTrack,
  openTestDatabase,
  reopenTestDatabase,
  migrateTestDatabase,
} from "./testDatabase.ts";
import { createPlaylist } from "./playlists.ts";
import { addCandidates } from "./candidateCatalog.ts";
import {
  dismissPlaylistRecommendation,
  selectPlaylistRecommendationInput,
} from "./playlistRecommendations.ts";

test("playlist dismissals upgrade, persist across database restart, and stay with their playlist identity", async () => {
  let db = await openTestDatabase({ through: "0035_candidate_catalog" });
  const seed = addTrack(db, { title: "Green Light", artist: "Lorde", genre: "Pop" });
  const favorite = addTrack(db, { title: "Style", artist: "Taylor Swift", genre: "Pop" });
  setFavorites(db, [favorite], true, 1);
  const first = createPlaylist(
    db,
    "Alternative pop",
    [{ source: "library", trackId: seed }],
    1,
  ).playlistId;
  const other = createPlaylist(db, "Other", [{ source: "library", trackId: seed }], 1).playlistId;
  await migrateTestDatabase(db);
  const input = selectPlaylistRecommendationInput(db, first);
  const song = input.library.find((t) => t.id === String(favorite))!;
  const offer = { key: "dismiss-1", track: song };
  assert.equal(dismissPlaylistRecommendation(db, first, offer, 2), true);
  assert.equal(dismissPlaylistRecommendation(db, first, offer, 3), false);
  db = await reopenTestDatabase(db);
  assert.deepEqual(selectPlaylistRecommendationInput(db, first).feedback, [
    { track: song, value: -1 },
  ]);
  assert.deepEqual(selectPlaylistRecommendationInput(db, other).feedback, []);
  assert.equal(
    selectPlaylistRecommendationInput(db, other).library.find((t) => t.id === song.id)?.favorite,
    true,
  );
});

test("real-store dismissal failure is retryable and refill preserves the other offers without changing global taste", async () => {
  const db = await openTestDatabase();
  const seed = addTrack(db, { title: "Seed", artist: "Radiohead", genre: "Rock" });
  for (const title of ["A", "B", "C", "D", "E", "F", "G"])
    addTrack(db, { title, artist: "Radiohead", genre: "Rock" });
  const playlistId = createPlaylist(
    db,
    "Alternative",
    [{ source: "library", trackId: seed }],
    1,
  ).playlistId;
  const baseline = tasteHistory(db);
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      const input = selectPlaylistRecommendationInput(db, playlistId);
      return { playlist: input.playlist, sources: { ...input, graph: null, now: 10 } };
    },
    dismiss: async (offer) => dismissPlaylistRecommendation(db, playlistId, offer, 10),
  });
  await session.renew();
  const before = session.get().slots;
  db.run(
    sql`CREATE TEMP TRIGGER reject_feedback BEFORE INSERT ON playlist_recommendation_feedback BEGIN SELECT RAISE(ABORT, 'disk full'); END`,
  );
  assert.equal(await session.dismiss(before[2]!.key), false);
  assert.equal(session.get().error, "save");
  assert.deepEqual(session.get().slots, before);
  assert.deepEqual(selectPlaylistRecommendationInput(db, playlistId).feedback, []);
  db.run(sql`DROP TRIGGER reject_feedback`);
  assert.equal(await session.dismiss(before[2]!.key), true);
  assert.equal(selectPlaylistRecommendationInput(db, playlistId).feedback.length, 1);
  assert.equal(session.get().slots[2]?.track.title, "F");
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.deepEqual(tasteHistory(db), baseline);
});

test("the stored playlist seeds ranked Library/catalog suggestions with recording exclusions and offline fallback", async () => {
  const db = await openTestDatabase();
  const seed = addTrack(db, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    genre: "Alternative Rock",
  });
  const next = addTrack(db, {
    title: "Let Down",
    artist: "Radiohead",
    album: "OK Computer",
    genre: "Alternative Rock",
  });
  const { playlistId } = createPlaylist(
    db,
    "Alternative",
    [{ source: "library", trackId: seed }],
    100,
  );
  const song = {
    videoId: "copy",
    title: "Airbag (Remastered)",
    artists: ["Radiohead"],
    album: "OK Computer",
    albumId: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  };
  addCandidates(
    db,
    {
      seed: "Radiohead",
      songs: [
        song,
        { ...song, videoId: "local-copy", title: "Let Down" },
        { ...song, videoId: "new", title: "Lucky" },
      ],
    },
    100,
  );
  const input = selectPlaylistRecommendationInput(db, playlistId);
  const pick = (online: boolean) =>
    playlistRecommendations(input.playlist, { ...input, graph: null, now: 100, online });
  assert.deepEqual(
    pick(true).map((x) => x.track.id),
    [String(next), "yt:new"],
  );
  assert.deepEqual(
    pick(false).map((x) => x.track.id),
    [String(next)],
  );
  assert.deepEqual(
    playlistRecommendations(input.playlist, {
      ...input,
      graph: null,
      now: 100,
      ytMusicEnabled: false,
    }).map((x) => x.track.id),
    [String(next)],
  );
  const empty = createPlaylist(db, "Empty", [], 100);
  assert.deepEqual(
    playlistRecommendations([], {
      ...selectPlaylistRecommendationInput(db, empty.playlistId),
      graph: null,
      now: 100,
    }),
    [],
  );
});

test("renewals read changed favorites and download status, including a catalog pending favorite", async () => {
  const db = await openTestDatabase();
  const seed = addTrack(db, { title: "Seed", artist: "Radiohead", genre: "Alternative Rock" });
  const ordinary = addTrack(db, {
    title: "Ordinary",
    artist: "Radiohead",
    genre: "Alternative Rock",
  });
  const favorite = addTrack(db, {
    title: "Favorite",
    artist: "Slowdive",
    genre: "Alternative Rock",
  });
  const download = addTrack(db, { title: "Download", artist: "Blur", genre: "Alternative Rock" });
  const { playlistId } = createPlaylist(
    db,
    "Alternative",
    [{ source: "library", trackId: seed }],
    100,
  );
  setFavorites(db, [favorite], true, 101);
  db.update(schema.tracks)
    .set({ videoId: "downloaded" })
    .where(eq(schema.tracks.id, download))
    .run();
  const song = {
    videoId: "pending",
    title: "Pending",
    artists: ["Radiohead"],
    album: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  };
  addCandidates(db, { seed: "Radiohead", songs: [song] }, 100);
  addPendingFavorites(db, [song], 100);
  const read = () => {
    const input = selectPlaylistRecommendationInput(db, playlistId);
    return playlistRecommendations(input.playlist, { ...input, graph: null, now: 100 });
  };
  assert.deepEqual(
    new Set(
      read()
        .slice(0, 3)
        .map((x) => x.track.id),
    ),
    new Set([String(favorite), String(download), "yt:pending"]),
  );
  setFavorites(db, [favorite], false, 102);
  assert.equal(read().at(-1)?.track.id, String(favorite));
  assert.ok(read().some((x) => x.track.id === String(ordinary)));
});
