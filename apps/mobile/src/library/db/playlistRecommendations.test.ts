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
  rankRadioSongs,
  type PlaylistRecommendationTrack,
  type YtAlbumSong,
} from "@wave/core";
import { tasteHistory } from "./taste.ts";
import {
  addHistory,
  addTrack,
  openTestDatabase,
  reopenTestDatabase,
  migrateTestDatabase,
  traceQueries,
} from "./testDatabase.ts";
import { addToPlaylist, createPlaylist, selectPlaylistEntries } from "./playlists.ts";
import { addCandidates, selectCandidateCatalog } from "./candidateCatalog.ts";
import {
  acceptPlaylistRecommendation,
  dismissPlaylistRecommendation,
  selectPlaylistRecommendationInput,
} from "./playlistRecommendations.ts";

/** A seed's radio bringing [songs], or every Library song of the input, in order. */
const radio = (songs: readonly YtAlbumSong[]) => [
  { id: "song:seed", artists: ["Radiohead"], songs },
];
const libraryRadio = (input: { readonly library: readonly PlaylistRecommendationTrack[] }) =>
  radio(input.library);

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

test("radio acceptance saves a stream without favoriting or downloading, and resolves a newly downloaded recording once", async () => {
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
  const first = createPlaylist(db, "First", [{ source: "library", trackId: seed }], 1).playlistId;
  const second = createPlaylist(db, "Second", [{ source: "library", trackId: seed }], 1).playlistId;
  const input = selectPlaylistRecommendationInput(db, first);
  const track = playlistRecommendations(input.playlist, {
    ...input,
    pages: radio([song]),
    graph: null,
  })[0]!.track;
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

test("acceptance follows a downloaded video's identity despite edited tags, and rejects a file lost since display", async () => {
  const db = await openTestDatabase();
  const seed = addTrack(db, { title: "Seed", artist: "Radiohead", genre: "Rock" });
  const missing = addTrack(db, { title: "Missing", artist: "Radiohead", genre: "Rock" });
  const playlistId = createPlaylist(
    db,
    "Alternative",
    [{ source: "library", trackId: seed }],
    1,
  ).playlistId;
  const missingOffer = {
    key: "file-lost",
    track: selectPlaylistRecommendationInput(db, playlistId).library.find(
      (song) => song.id === String(missing),
    )!,
  };
  const song = {
    videoId: "download-arrived",
    title: "Lucky",
    artists: ["Radiohead"],
    album: "OK Computer",
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  };
  const input = selectPlaylistRecommendationInput(db, playlistId);
  const streamOffer = {
    key: "edited-download",
    track: playlistRecommendations(input.playlist, {
      ...input,
      pages: radio([{ ...song, albumId: null }]),
      graph: null,
    }).find((offer) => offer.track.videoId === song.videoId)!.track,
  };
  const download = addTrack(db, {
    title: "Edited title",
    artist: "Edited artist",
    durationMs: 220000,
  });
  db.update(schema.tracks)
    .set({ videoId: song.videoId })
    .where(eq(schema.tracks.id, download))
    .run();
  db.update(schema.tracks).set({ path: null }).where(eq(schema.tracks.id, missing)).run();
  assert.throws(() => acceptPlaylistRecommendation(db, playlistId, missingOffer, 2));
  assert.deepEqual(selectPlaylistRecommendationInput(db, playlistId).feedback, []);
  assert.equal(acceptPlaylistRecommendation(db, playlistId, streamOffer, 3), true);
  assert.equal(
    acceptPlaylistRecommendation(db, playlistId, { ...streamOffer, key: "stale-stream" }, 4),
    false,
  );
  assert.deepEqual(
    selectPlaylistEntries(db, playlistId).map((entry) =>
      entry.source === "library" ? entry.track.id : null,
    ),
    [seed, download],
  );
  assert.deepEqual(
    selectPlaylistRecommendationInput(db, playlistId).feedback.map(({ track, value }) => ({
      id: track.id,
      value,
    })),
    [{ id: String(download), value: 1 }],
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
    rankRadioSongs(
      { artists: ["Radiohead"] },
      {
        pages: [
          {
            id: "seed",
            artists: ["Radiohead"],
            songs: selectCandidateCatalog(db).map((entry) => entry.song),
          },
        ],
      },
    );
  const beforeGlobal = globalRanking();
  assert.equal(beforeGlobal.length, 2);
  const picks = (id: number) => {
    const input = selectPlaylistRecommendationInput(db, id);
    return playlistRecommendations(input.playlist, {
      ...input,
      pages: libraryRadio(input),
      graph,
      online: false,
    });
  };
  const otherBefore = picks(otherId);
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => `flow-${++id}`,
    read: async () => {
      const input = selectPlaylistRecommendationInput(db, playlistId);
      return {
        playlist: input.playlist,
        sources: { ...input, pages: libraryRadio(input), graph, online: false },
      };
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
  // Each by their own artist: the suggestions hold at most 2 songs by one.
  for (const title of ["A", "B", "C", "D", "E", "F", "G"])
    addTrack(db, { title, artist: `Artist ${title}`, genre: "Rock" });
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
      return {
        playlist: input.playlist,
        sources: { ...input, pages: libraryRadio(input), graph: null },
      };
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

for (const timing of [
  "own Add",
  "during save",
  "before refill snapshot",
  "after refill snapshot",
]) {
  test(`real-store Add preserves held offers and processes external membership changes: ${timing}`, async () => {
    const db = await openTestDatabase();
    const seed = addTrack(db, { title: "Seed", artist: "Radiohead", genre: "Rock" });
    for (const title of "ABCDEFGH")
      addTrack(db, { title, artist: `Artist ${title}`, genre: "Rock" });
    const { playlistId } = createPlaylist(
      db,
      "Alternative",
      [{ source: "library", trackId: seed }],
      1,
    );
    let id = 0;
    let pause = false;
    const blocked = Promise.withResolvers<void>();
    const resumed = Promise.withResolvers<void>();
    const session = playlistRecommendationSession({
      newId: () => String(++id),
      read: async () => {
        if (pause && timing === "before refill snapshot") {
          pause = false;
          blocked.resolve();
          await resumed.promise;
        }
        const input = selectPlaylistRecommendationInput(db, playlistId);
        if (pause && timing === "after refill snapshot") {
          pause = false;
          blocked.resolve();
          await resumed.promise;
        }
        return {
          playlist: input.playlist,
          sources: { ...input, pages: libraryRadio(input), graph: null },
        };
      },
      dismiss: async (offer) => dismissPlaylistRecommendation(db, playlistId, offer, 10),
      accept: async (offer) => {
        if (timing === "during save") {
          blocked.resolve();
          await resumed.promise;
        }
        return acceptPlaylistRecommendation(db, playlistId, offer, 10);
      },
    });
    await session.renew();
    const before = session.get().slots;
    assert.deepEqual(
      before.map((offer) => offer?.track.title),
      ["A", "B", "C", "D", "E"],
    );
    pause = true;
    const accepting = session.accept(before[2]!.key);
    if (timing !== "own Add") {
      await blocked.promise;
      addToPlaylist(
        db,
        playlistId,
        [{ source: "library", trackId: Number(before[0]!.track.id) }],
        10,
      );
      await session.renew();
      resumed.resolve();
    }
    assert.equal(await accepting, true);
    assert.deepEqual(
      session.get().slots.map((offer) => offer?.track.title),
      [timing === "own Add" ? "A" : "G", "B", "F", "D", "E"],
    );
    if (timing === "own Add") {
      for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
    }
    for (const index of [1, 3, 4])
      assert.equal(session.get().slots[index]?.key, before[index]!.key);
    assert.equal(selectPlaylistRecommendationInput(db, playlistId).feedback.length, 1);
    assert.deepEqual(session.get().pending, []);
    assert.equal(session.get().loading, false);
    assert.equal(session.get().error, null);
  });
}

test("the stored playlist ranks its seeds' radios with Library recordings, recording exclusions and offline fallback with recording exclusions and offline fallback", async () => {
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
  const pages = radio([
    song,
    { ...song, videoId: "local-copy", title: "Let Down" },
    { ...song, videoId: "new", title: "Lucky" },
  ]);
  const input = selectPlaylistRecommendationInput(db, playlistId);
  const pick = (online: boolean) =>
    playlistRecommendations(input.playlist, { ...input, pages, graph: null, online });
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
      pages,
      graph: null,
      ytMusicEnabled: false,
    }).map((x) => x.track.id),
    [String(next)],
  );
  const empty = createPlaylist(db, "Empty", [], 100);
  assert.deepEqual(
    playlistRecommendations([], {
      ...selectPlaylistRecommendationInput(db, empty.playlistId),
      pages,
      graph: null,
    }),
    [],
  );
});

test("renewals read changed favorites and download status, including a radio's pending favorite", async () => {
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
  addPendingFavorites(db, [song], 100);
  const read = () => {
    const input = selectPlaylistRecommendationInput(db, playlistId);
    return playlistRecommendations(input.playlist, {
      ...input,
      pages: radio([...input.library, { ...song, albumId: null }]),
      graph: null,
    });
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

test("Add validates its held recording without reading the entire Library", async () => {
  const { createFastAgainFixture } = await import("./fastAgainFixture.ts");
  const { traceQueries } = await import("./testDatabase.ts");
  const fixture = await createFastAgainFixture();
  try {
    const input = selectPlaylistRecommendationInput(fixture.db, fixture.playlistId);
    const track = playlistRecommendations(input.playlist, {
      ...input,
      pages: libraryRadio(input),
      graph: null,
      online: false,
    })[0]!.track;
    const result = traceQueries(fixture.db, () =>
      acceptPlaylistRecommendation(
        fixture.db,
        fixture.playlistId,
        { key: "bounded-add", track },
        fixture.now,
      ),
    );
    assert.equal(result.result, true);
    assert.ok(
      result.queries.reduce((sum, q) => sum + q.rows, 0) < 300,
      "transaction reads only playlist membership and matching recording metadata",
    );
  } finally {
    fixture.close();
  }
});

const rowsOf = (queries: readonly { readonly rows: number }[]) =>
  queries.reduce((n, query) => n + query.rows, 0);

/** Rows read by one Add and one Dismiss of Library offers, in a Library of [librarySize] songs. */
const addAndDismissRows = async (librarySize: number) => {
  const db = await openTestDatabase();
  const seed = addTrack(db, { title: "Seed", artist: "Radiohead", genre: "Rock" });
  addHistory(db, { artist: "Radiohead", tracks: librarySize, plays: 1 });
  const playlistId = createPlaylist(
    db,
    "Alternative",
    [{ source: "library", trackId: seed }],
    1,
  ).playlistId;
  const library = selectPlaylistRecommendationInput(db, playlistId).library;
  const [added, dismissed] = library.filter((track) => track.id !== String(seed));
  const accept = traceQueries(db, () =>
    acceptPlaylistRecommendation(db, playlistId, { key: "add", track: added! }, 2),
  );
  const dismiss = traceQueries(db, () =>
    dismissPlaylistRecommendation(db, playlistId, { key: "dismiss", track: dismissed! }, 3),
  );
  assert.equal(accept.result, true);
  assert.equal(dismiss.result, true);
  // Exactly once: the same offers again write nothing.
  assert.equal(
    acceptPlaylistRecommendation(db, playlistId, { key: "add", track: added! }, 4),
    false,
  );
  assert.equal(
    dismissPlaylistRecommendation(db, playlistId, { key: "dismiss", track: dismissed! }, 5),
    false,
  );
  assert.deepEqual(
    selectPlaylistEntries(db, playlistId).map((x) => (x.source === "library" ? x.track.id : null)),
    [seed, Number(added!.id)],
  );
  assert.deepEqual(
    selectPlaylistRecommendationInput(db, playlistId)
      .feedback.map((x) => x.value)
      .toSorted(),
    [-1, 1],
  );
  return { accept: rowsOf(accept.queries), dismiss: rowsOf(dismiss.queries) };
};

test("Add and Dismiss of a Library offer read rows bounded by the playlist, not by the Library's size", async () => {
  const small = await addAndDismissRows(20);
  const large = await addAndDismissRows(400);
  assert.deepEqual(large, small);
  // Dismiss: the playlist's own row and the feedback row it wrote.
  assert.equal(small.dismiss, 2);
});
