import { eq, sql } from "drizzle-orm";
import * as schema from "./schema.ts";
import { setFavorites } from "./playHistory.ts";
import { addPendingFavorites } from "./pendingFavorites.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  playlistRecommendations,
  playlistRecommendationSession,
  artistGraph,
  recommend,
} from "@wave/core";
import { tasteHistory } from "./taste.ts";
import {
  addTrack,
  openTestDatabase,
  reopenTestDatabase,
  migrateTestDatabase,
} from "./testDatabase.ts";
import { createPlaylist, selectPlaylistEntries } from "./playlists.ts";
import { addCandidates, selectCandidateCatalog } from "./candidateCatalog.ts";
import {
  acceptPlaylistRecommendation,
  dismissPlaylistRecommendation,
  selectPlaylistRecommendationInput,
} from "./playlistRecommendations.ts";

test("acceptance commits membership and feedback together, once, and never learns from a failed or preexisting addition", async () => {
  const db = await openTestDatabase();
  const seed = addTrack(db, { title: "Seed", artist: "Radiohead", genre: "Rock" });
  const next = addTrack(db, { title: "Next", artist: "Radiohead", genre: "Rock" });
  const playlistId = createPlaylist(
    db,
    "Alternative",
    [{ source: "library", trackId: seed }],
    1,
  ).playlistId;
  const song = selectPlaylistRecommendationInput(db, playlistId).library.find(
    (t) => t.id === String(next),
  )!;
  const offer = { key: "accept-1", track: song };
  db.run(
    sql`CREATE TEMP TRIGGER reject_acceptance BEFORE INSERT ON playlist_recommendation_feedback WHEN NEW.value = 1 BEGIN SELECT RAISE(ABORT, 'disk full'); END`,
  );
  assert.throws(() => acceptPlaylistRecommendation(db, playlistId, offer, 2));
  assert.deepEqual(
    selectPlaylistEntries(db, playlistId).map((x) => (x.source === "library" ? x.track.id : null)),
    [seed],
  );
  assert.deepEqual(selectPlaylistRecommendationInput(db, playlistId).feedback, []);
  db.run(sql`DROP TRIGGER reject_acceptance`);
  assert.equal(acceptPlaylistRecommendation(db, playlistId, offer, 3), true);
  assert.equal(acceptPlaylistRecommendation(db, playlistId, offer, 4), false);
  assert.equal(
    acceptPlaylistRecommendation(db, playlistId, { ...offer, key: "another-offer" }, 5),
    false,
  );
  assert.deepEqual(
    selectPlaylistEntries(db, playlistId).map((x) => (x.source === "library" ? x.track.id : null)),
    [seed, next],
  );
  assert.deepEqual(selectPlaylistRecommendationInput(db, playlistId).feedback, [
    { track: song, value: 1 },
  ]);
});

test("catalog acceptance saves a stream without favoriting or downloading, and resolves a newly downloaded recording once", async () => {
  let db = await openTestDatabase();
  const seed = addTrack(db, { title: "Airbag", artist: "Radiohead", genre: "Rock" });
  const song = {
    videoId: "lucky",
    title: "Lucky",
    artists: ["Radiohead"],
    album: "OK Computer",
    albumId: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  };
  addCandidates(db, { seed: "Radiohead", songs: [song] }, 1);
  const first = createPlaylist(db, "First", [{ source: "library", trackId: seed }], 1).playlistId;
  const second = createPlaylist(db, "Second", [{ source: "library", trackId: seed }], 1).playlistId;
  const input = selectPlaylistRecommendationInput(db, first);
  const track = playlistRecommendations(input.playlist, { ...input, graph: null, now: 1 })[0]!
    .track;
  const baseline = tasteHistory(db);
  assert.equal(acceptPlaylistRecommendation(db, first, { key: "online", track }, 2), true);
  assert.equal(selectPlaylistEntries(db, first)[1]?.source, "stream");
  assert.deepEqual(tasteHistory(db), baseline);
  assert.equal(selectPlaylistRecommendationInput(db, first).favoriteVideos.size, 0);
  db = await reopenTestDatabase(db);
  assert.equal(selectPlaylistRecommendationInput(db, first).feedback[0]?.value, 1);
  assert.equal(selectPlaylistEntries(db, first)[1]?.source, "stream");
  const downloaded = addTrack(db, {
    title: "Lucky (Remastered)",
    artist: "Radiohead",
    genre: "Rock",
  });
  db.update(schema.tracks).set({ videoId: "lucky" }).where(eq(schema.tracks.id, downloaded)).run();
  assert.equal(
    acceptPlaylistRecommendation(db, second, { key: "download-arrived", track }, 3),
    true,
  );
  const entry = selectPlaylistEntries(db, second)[1]!;
  assert.equal(entry.source, "library");
  if (entry.source === "library") assert.equal(entry.track.id, downloaded);
  assert.equal(
    acceptPlaylistRecommendation(db, first, { key: "duplicate-recording", track }, 4),
    false,
  );
  assert.equal(selectPlaylistEntries(db, first).length, 2);
  assert.equal(selectPlaylistRecommendationInput(db, first).feedback.length, 1);
  assert.equal(
    selectPlaylistRecommendationInput(db, second).library.find((t) => t.id === String(downloaded))
      ?.favorite,
    false,
  );
});

test("dismiss then accept refills from updated contents, persists scoped learning, and exhausts truthfully without global changes", async () => {
  let db = await openTestDatabase();
  const seed = addTrack(db, { title: "Seed", artist: "Radiohead", genre: "Rock" });
  for (const [title, artist] of [
    ["A", "Blur"],
    ["B", "Portishead"],
    ["C", "Taylor Swift"],
    ["D", "Slowdive"],
    ["E", "Pulp"],
    ["F", "Oasis"],
    ["G", "Portishead"],
    ["H", "Suede"],
  ])
    addTrack(db, { title: title!, artist: artist!, genre: "Rock" });
  const playlistId = createPlaylist(
    db,
    "Alternative",
    [{ source: "library", trackId: seed }],
    1,
  ).playlistId;
  const otherId = createPlaylist(db, "Other", [{ source: "library", trackId: seed }], 1).playlistId;
  addCandidates(
    db,
    {
      seed: "Radiohead",
      songs: ["online-a", "online-b"].map((videoId) => ({
        videoId,
        title: videoId,
        artists: ["Catalog artist"],
        album: null,
        durationMs: 180000,
        artworkUrl: null,
        explicit: false,
      })),
    },
    1,
  );
  const graph = artistGraph({ catalog: selectCandidateCatalog(db), pages: [], plays: [] });
  const baselineTaste = tasteHistory(db);
  const baselineCatalog = selectCandidateCatalog(db);
  const globalRanking = () =>
    recommend(
      { artists: ["Radiohead"] },
      { catalog: selectCandidateCatalog(db), graph, now: 0, profileOf: () => null },
    );
  const beforeGlobal = globalRanking();
  assert.equal(beforeGlobal.length, 2);
  const picks = (id: number) => {
    const input = selectPlaylistRecommendationInput(db, id);
    return playlistRecommendations(input.playlist, { ...input, graph, now: 0, online: false });
  };
  const otherBefore = picks(otherId);
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => `flow-${++id}`,
    read: async () => {
      const input = selectPlaylistRecommendationInput(db, playlistId);
      return { playlist: input.playlist, sources: { ...input, graph, now: 0, online: false } };
    },
    dismiss: async (offer) => dismissPlaylistRecommendation(db, playlistId, offer, 2),
    accept: async (offer) => acceptPlaylistRecommendation(db, playlistId, offer, 3),
  });
  await session.renew();
  const initial = session.get().slots;
  assert.equal(await session.dismiss(initial[2]!.key), true);
  assert.equal(session.get().slots[2]?.track.title, "F");
  const beforeAccept = session.get().slots;
  assert.equal(await session.accept(initial[1]!.key), true);
  assert.equal(session.get().slots[1]?.track.title, "G"); // now shares the newly accepted artist
  for (const index of [0, 2, 3, 4]) assert.equal(session.get().slots[index], beforeAccept[index]);
  db = await reopenTestDatabase(db);
  assert.deepEqual(
    new Map(
      selectPlaylistRecommendationInput(db, playlistId).feedback.map((x) => [
        x.track.title,
        x.value,
      ]),
    ),
    new Map([
      ["C", -1],
      ["B", 1],
    ]),
  );
  assert.deepEqual(
    selectPlaylistRecommendationInput(db, playlistId).playlist.map((x) => x.title),
    ["Seed", "B"],
  );
  assert.deepEqual(picks(otherId), otherBefore);
  assert.deepEqual(selectPlaylistRecommendationInput(db, otherId).feedback, []);
  assert.deepEqual(tasteHistory(db), baselineTaste);
  assert.deepEqual(selectCandidateCatalog(db), baselineCatalog);
  assert.deepEqual(globalRanking(), beforeGlobal);
  while (session.get().slots.some((x) => x !== null)) {
    const offer = session.get().slots.find((x) => x !== null)!;
    assert.equal(await session.accept(offer.key), true);
  }
  assert.equal(session.get().error, null);
  assert.equal(selectPlaylistRecommendationInput(db, playlistId).playlist.length, 8); // seed + seven accepted, C dismissed
  assert.equal(
    selectPlaylistRecommendationInput(db, playlistId).feedback.filter((x) => x.value === 1).length,
    7,
  );
});

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
  assert.equal(
    acceptPlaylistRecommendation(db, first, { key: "accept-after-reopen", track: song }, 4),
    true,
  );
  db = await reopenTestDatabase(db);
  assert.deepEqual(
    new Set(selectPlaylistRecommendationInput(db, first).feedback.map((x) => x.value)),
    new Set([-1, 1]),
  );
  assert.equal(
    selectPlaylistRecommendationInput(db, first).playlist.filter((x) => x.id === song.id).length,
    1,
  );
  assert.equal(
    selectPlaylistRecommendationInput(db, first).library.find((x) => x.id === song.id)?.favorite,
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
