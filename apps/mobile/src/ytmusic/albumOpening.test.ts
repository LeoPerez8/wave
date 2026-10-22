import assert from "node:assert/strict";
import { test } from "node:test";
import { albumRowsInPlace } from "./albumOpening.ts";

test("an online answer and a download leave the rows already shown in place", () => {
  const local = (id: number) => ({ source: "library" as const, track: { id }, number: id });
  const stream = (videoId: string) => ({ source: "stream" as const, song: { videoId }, number: 1 });
  const shown = [local(2), local(3)];
  const joined = albumRowsInPlace(shown, [stream("first"), local(3), local(2)]);
  assert.deepEqual(joined, [local(2), local(3), stream("first")]);
  assert.deepEqual(
    albumRowsInPlace(joined, [local(1), local(2), local(3)], () => ({ id: 1 })),
    [local(2), local(3), local(1)],
  );
});

test("an integrated album reads only its own rows and starts no YouTube ask before local content", async () => {
  const { createFastAgainFixture } = await import("../library/db/fastAgainFixture.ts");
  const { traceQueries } = await import("../library/db/testDatabase.ts");
  const { loadDetailOpening } = await import("../../bench/fastAgain/detailOpeningReplay.ts");
  const { fileURLToPath } = await import("node:url");
  const fixture = await createFastAgainFixture();
  try {
    const opening = await loadDetailOpening(
      process.env.DETAIL_OPENING_ROOT ?? fileURLToPath(new URL("../../../../", import.meta.url)),
      fixture.db,
    );
    const { result, queries } = traceQueries(fixture.db, () =>
      opening.album(fixture.albumId, fixture.now),
    );
    assert.equal(result.detail.tracks.length, 10);
    assert.equal(result.view?.tracks, null);
    const songRows = queries
      .filter((q) => /(?:"tracks"|tracks)\.(?:"title"|title)/.test(q.sql))
      .reduce((sum, q) => sum + q.rows, 0);
    assert.equal(songRows, 10, "the first rows never acquire the 1000-row shared finder");
  } finally {
    fixture.close();
  }
});

test("a real-store album stays usable while its deferred YouTube release never answers, then joins the answer", async () => {
  const { createFastAgainFixture } = await import("../library/db/fastAgainFixture.ts");
  const { loadDetailOpening } = await import("../../bench/fastAgain/detailOpeningReplay.ts");
  const { fileURLToPath } = await import("node:url");
  const Effect = await import("effect/Effect");
  const fixture = await createFastAgainFixture();
  try {
    const opening = await loadDetailOpening(
      process.env.DETAIL_OPENING_ROOT ?? fileURLToPath(new URL("../../../../", import.meta.url)),
      fixture.db,
    );
    const first = opening.album(fixture.albumId, fixture.now);
    const songs = first.detail.tracks.map((track) => ({
      videoId: `local-${track.id}`,
      title: track.title,
      artists: [track.artist],
      album: track.album,
      durationMs: track.durationMs,
      artworkUrl: null,
      albumId: null,
      explicit: false,
    }));
    songs.unshift({ ...songs[0]!, videoId: "remote-first", title: "Only online" });
    Effect.runSync(
      opening.store.saveYtArtist(opening.core.identityKey(first.artist.name), {
        outcome: "found",
        checkedAt: fixture.now,
        browseId: "artist",
        page: {
          name: first.artist.name,
          songs: [],
          albums: [
            {
              kind: "album",
              browseId: "release",
              title: first.detail.album.title,
              artists: [first.artist.name],
              year: null,
              artworkUrl: null,
            },
          ],
          singles: [],
        },
      }),
    );
    const local = opening.album(fixture.albumId, fixture.now);
    let requests = 0;
    let answer!: (value: typeof songs) => void;
    const request = Effect.promise(() => {
      requests++;
      return new Promise<typeof songs>((resolve) => {
        answer = resolve;
      });
    });
    const pending = Effect.runPromise(opening.request(() => true, request));
    assert.equal(requests, 1);
    assert.equal(local.detail.tracks.length, 10);
    assert.equal(local.view?.tracks, null, "the local list is usable without any YouTube answer");
    assert.equal(
      opening.core.ytAlbumOpening(local.state, { ...local.context, settled: false }).readRelease,
      null,
    );
    assert.equal(
      opening.core.ytAlbumOpening(local.state, { ...local.context, settled: true }).readRelease,
      "release",
    );
    answer(songs);
    const joined = opening.answer(local, await pending);
    assert.deepEqual(
      joined.slice(0, 10).map((row) => (row.source === "library" ? row.track.id : null)),
      local.detail.tracks.map((track) => track.id),
    );
    assert.equal(joined[10]?.source, "stream");
    assert.equal(joined.length, 11);
  } finally {
    fixture.close();
  }
});

test("joining online rows keeps the disc headers that already separate local tracks", async () => {
  const { albumJoinedItems } = await import("./albumOpening.ts");
  const tracks = [
    { id: 1, discNumber: 1 },
    { id: 2, discNumber: 2 },
  ];
  const entries = tracks.map((track) => ({ source: "library" as const, track, number: 1 }));
  const items = albumJoinedItems(tracks, [
    ...entries,
    { source: "stream" as const, song: { videoId: "extra" }, number: 3 },
  ]);
  assert.deepEqual(
    items.map((item) => (item.type === "disc" ? `disc-${item.disc}` : item.index)),
    ["disc-1", 0, "disc-2", 1, 2],
  );
  // A newly downloaded online track cannot introduce disc headers ahead of existing rows.
  const oneDisc = [tracks[0]!];
  assert.deepEqual(
    albumJoinedItems(oneDisc, entries).map((item) => item.type),
    ["entry", "entry"],
  );
});
