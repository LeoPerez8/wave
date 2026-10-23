import assert from "node:assert/strict";
import { test } from "node:test";
import {
  finishPlaylistImport,
  startPlaylistImport,
  planLinkImport,
  finishPlaylistImportSteps,
  planLinkImportSteps,
  replacementDuplicates,
  replacementDuplicatesSteps,
  reconcileScan,
  reconcileScanSteps,
} from "./index.ts";
const consume = <A>(steps: Generator<void, A>) => {
  let work = 0;
  for (;;) {
    const next = steps.next();
    if (next.done) return { result: next.value, work };
    work++;
  }
};

test("resumed imports keep source order, previously added entries and duplicates while stepping each input", () => {
  const source = {
    service: "spotify" as const,
    playlist: {
      title: "Saved",
      artworkUrl: null,
      total: 4,
      truncated: false,
      songs: ["One", "Two", "One", "Three"].map((title) => ({
        title,
        artists: ["A"],
        album: null,
        durationMs: 1000,
      })),
    },
  };
  const library = [{ id: 7, title: "One", artist: "A", durationMs: 1000 }];
  const plan = consume(planLinkImportSteps(source, library));
  assert.deepEqual(plan.result, planLinkImport(source, library));
  assert.ok(plan.work >= 5);
  const job = { ...startPlaylistImport(plan.result, { playlistId: 1, name: "Saved" }), added: 1 };
  const finished = consume(finishPlaylistImportSteps(job));
  assert.deepEqual(finished.result, finishPlaylistImport(job));
  assert.deepEqual(
    finished.result.songs.map((song) => song.source),
    ["unsearched", "unsearched"],
  );
  assert.ok(finished.work >= 3);
});

test("stepped duplicate detection preserves pair order, recording checks and older identity", () => {
  const file = (id: number, path: string, title = "Song") => ({
    id,
    path,
    title,
    artists: ["A"],
    recordingKey: null,
    durationMs: 1000,
    favorite: false,
    plays: 0,
    playlists: [],
  });
  const files = [
    file(1, "/a.mp3"),
    file(2, "/b.m4a"),
    file(3, "/b.mp3"),
    file(4, "/a.m4a"),
    file(5, "/c.mp3"),
    file(6, "/c.m4a", "Other"),
  ];
  const stepped = consume(replacementDuplicatesSteps(files));
  assert.deepEqual(stepped.result, replacementDuplicates(files));
  assert.deepEqual(
    stepped.result.map((pair) => [pair.new.id, pair.old.id]),
    [
      [1, 4],
      [2, 3],
    ],
  );
  assert.ok(stepped.work >= files.length * 2);
});

test("stepped scan preserves moves, updates, additions and unmatched order", () => {
  const file = (path: string, title: string) => ({
    path,
    title,
    artist: "A",
    durationMs: 1000,
    sizeBytes: 100,
  });
  const input = {
    missing: [file("/old", "Moved"), file("/gone", "Gone")],
    read: [file("/new", "Moved"), file("/same", "Changed"), file("/added", "Added")],
    isIndexed: (path: string) => path === "/same",
  };
  const stepped = consume(reconcileScanSteps(input));
  assert.deepEqual(stepped.result, reconcileScan(input));
  assert.deepEqual(
    stepped.result.moved.map((m) => m.from),
    ["/old"],
  );
  assert.deepEqual(
    stepped.result.unmatched.map((f) => f.path),
    ["/gone"],
  );
  assert.ok(stepped.work >= 5);
});

test("completion prepares the same kept notice and log in bounded per-row work", async () => {
  const { playlistImportCompletionSteps, updatePlaylistImport, importLogLine } =
    await import("./playlistImport.ts");
  const source = {
    service: "spotify" as const,
    playlist: {
      title: "Saved",
      artworkUrl: null,
      total: 2,
      truncated: false,
      songs: ["One", "One"].map((title) => ({
        title,
        artists: ["A"],
        album: null,
        durationMs: 1000,
      })),
    },
  };
  const job = startPlaylistImport(planLinkImport(source, []), { playlistId: 1, name: "Saved" });
  const done = finishPlaylistImport(job).job;
  const completion = consume(playlistImportCompletionSteps(done, true));
  assert.deepEqual(
    updatePlaylistImport([job], completion.result.kept),
    updatePlaylistImport([job], done),
  );
  assert.equal(completion.result.line, importLogLine(done, { resumed: true }));
});

test("a resumed Liked Songs read steps its favorite choices without changing download policy", async () => {
  const { ytLibraryFavorites, ytLibraryFavoritesSteps, queueYtLibraryReads, NO_YT_LIBRARY_READS } =
    await import("./index.ts");
  const read = queueYtLibraryReads(NO_YT_LIBRARY_READS, [
    { source: "LM", playlistId: 1, name: "Liked", capped: false, favorites: true },
  ]).reads[0]!;
  const plan = {
    finds: [
      { kind: "library" as const, trackId: 7 },
      {
        kind: "ytMusic" as const,
        song: {
          videoId: "v",
          title: "Stream",
          artists: ["A"],
          album: null,
          durationMs: 1000,
          artworkUrl: null,
          explicit: false,
        },
      },
    ],
  };
  const stepped = consume(ytLibraryFavoritesSteps(read, plan));
  assert.deepEqual(stepped.result, ytLibraryFavorites(read, plan));
  assert.equal(stepped.work, 2);
});

test("duplicate fixes and log preparation step large playlist histories without changing their outcome", async () => {
  const {
    replacementDuplicateFix,
    replacementDuplicateFixSteps,
    replacementDuplicateLines,
    replacementDuplicateLinesSteps,
  } = await import("./index.ts");
  const kept = {
    id: 1,
    path: "/song.mp3",
    title: "Song",
    artists: ["A"],
    recordingKey: null,
    durationMs: 1000,
    favorite: false,
    plays: 0,
    playlists: Array.from({ length: 1000 }, (_, i) => i),
  };
  const dropped = {
    ...kept,
    id: 2,
    path: "/song.m4a",
    favorite: true,
    plays: 8,
    playlists: [1, 999, 1001],
  };
  const pair = { new: kept, old: dropped },
    lengths = { old: 1000, new: 1000 };
  const stepped = consume(replacementDuplicateFixSteps(pair, lengths));
  assert.deepEqual(stepped.result, replacementDuplicateFix(pair, lengths));
  assert.ok(stepped.work >= 1003);
  assert.equal(stepped.result.kind, "fix");
  if (stepped.result.kind === "fix")
    assert.deepEqual(stepped.result.merge, {
      star: true,
      movePlays: true,
      repoint: [1001],
      remove: [1, 999],
    });
  const outcomes = [{ pair, outcome: stepped.result }];
  assert.deepEqual(
    consume(replacementDuplicateLinesSteps("update", outcomes)).result,
    replacementDuplicateLines("update", outcomes),
  );
});
