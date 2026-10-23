/** Public artist metadata and the real SQLite work behind a small result. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { selectArtistsBefore600 } from "../../../bench/fastAgain/artistCountReference.ts";
import { loadLibraryStore } from "../../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "./fastAgainFixture.ts";
import { traceQueries } from "./testDatabase.ts";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

test("ranked artist metadata seeks requested credits before deduplication", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(ROOT, fixture.db);
    const ids = [fixture.targets.small.artistId, fixture.targets.large.artistId];
    const read = traceQueries(fixture.db, () => Effect.runSync(store.artistsByIds(ids)));
    assert.deepEqual(read.result, selectArtistsBefore600(fixture.db, { ids }));
    assert.deepEqual(
      read.result.map((row) => row.trackCount).toSorted((a, b) => a - b),
      [20, 300],
    );
    const plan = read.queries.flatMap((query) => query.plan);
    for (const index of [
      "track_artists_artist_idx",
      "album_artists_artist_idx",
      "tracks_album_idx",
      "albums_album_artist_idx",
    ])
      assert.ok(
        plan.some((step) => step.includes("SEARCH") && step.includes(index)),
        index,
      );
    assert.ok(
      !plan.some((step) => /SCAN (?:track_artists|album_artists|tracks)\b/.test(step)),
      plan.join("\n"),
    );
  } finally {
    fixture.close();
  }
});

test("artist pages select file membership in sort order before counting page credits", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(ROOT, fixture.db);
    const page = { offset: 5, limit: 3 };
    const read = traceQueries(fixture.db, () => Effect.runSync(store.listArtistsPage(page)));
    assert.deepEqual(read.result, selectArtistsBefore600(fixture.db, { page, scope: "files" }));
    assert.equal(read.result.length, 3);
    const plan = read.queries.flatMap((query) => query.plan);
    assert.ok(
      plan.some((step) => step.includes("artists_sort_idx")),
      plan.join("\n"),
    );
    for (const index of [
      "track_artists_artist_idx",
      "album_artists_artist_idx",
      "tracks_album_idx",
    ])
      assert.ok(
        plan.some((step) => step.includes("SEARCH") && step.includes(index)),
        index,
      );
    assert.ok(
      !plan.some((step) => /SCAN (?:track_artists|album_artists|tracks)\b/.test(step)),
      plan.join("\n"),
    );
  } finally {
    fixture.close();
  }
});

test("growing unrelated credits leaves ranked reads and a fixed artist page's credit work bounded", async () => {
  const { addHistory, traceArtistCreditVisits } = await import("./testDatabase.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(ROOT, fixture.db);
    const ids = [fixture.targets.small.artistId, fixture.targets.large.artistId];
    const page = { offset: 5, limit: 3 };
    const reads = [
      () => Effect.runSync(store.artistsByIds(ids)),
      () => Effect.runSync(store.listArtistsPage(page)),
    ];
    const before = reads.map((read) => traceArtistCreditVisits(fixture.db, read));
    assert.ok(before.every((row) => row.visits.trackCredits > 0 && row.visits.albumCredits > 0));
    for (const tracks of [1000, 12000, 50000]) {
      addHistory(fixture.db, { artist: `zzzz unrelated ${tracks}`, tracks, plays: 1 });
      for (const [i, read] of reads.entries()) {
        const after = traceArtistCreditVisits(fixture.db, read);
        assert.deepEqual(after.result, before[i]!.result);
        assert.deepEqual(after.visits, before[i]!.visits, `${tracks} unrelated credits, read ${i}`);
        assert.deepEqual(after.result, read(), "observation must preserve complete rows");
      }
    }
    const legacy = traceArtistCreditVisits(fixture.db, () =>
      selectArtistsBefore600(fixture.db, { ids }),
    );
    assert.ok(legacy.visits.trackCredits > 63000, "the observer must detect the old global walk");
    assert.deepEqual(legacy.result, before[0]!.result);
  } finally {
    fixture.close();
  }
});

test("complete metadata preserves collaboration, album-only, compilation, missing and tied-order semantics", async () => {
  const { eq, sql } = await import("drizzle-orm");
  const schema = await import("./schema.ts");
  const { selectArtists, selectArtistDetail, refreshArtistImages } = await import("./artists.ts");
  const { openTestDatabase, closeTestDatabase, addTrack, addMissingSong } =
    await import("./testDatabase.ts");
  const db = await openTestDatabase();
  try {
    const local = addTrack(db, {
      title: "Duet",
      artist: "Lead",
      album: "Shared",
      artworkHash: "shared",
    });
    addMissingSong(db, { title: "Missing duet", artist: "Lead", album: "Shared" });
    addTrack(db, {
      title: "Guest hit",
      artist: "Guest",
      album: "Compilation",
      albumArtist: "Various",
      artworkHash: "comp",
    });
    addMissingSong(db, { title: "Missing only", artist: "Missing only" });
    const empty = addTrack(db, { title: "Removed", artist: "Lead", album: "Empty retained album" });
    const gone = addTrack(db, { title: "Gone", artist: "Gone" });
    db.delete(schema.tracks).where(eq(schema.tracks.id, empty)).run();
    db.delete(schema.tracks).where(eq(schema.tracks.id, gone)).run();
    db.run(
      sql`INSERT INTO artists (key, name, sort) VALUES ('album-only', 'Album only', 'tie'), ('orphan', 'Orphan', '00')`,
    );
    const artistId = (name: string) =>
      db.get<{ id: number }>(sql`SELECT id FROM artists WHERE name = ${name}`).id;
    const lead = artistId("Lead");
    const guest = artistId("Guest");
    const albumOnly = artistId("Album only");
    const album = db.get<{ id: number }>(
      sql`SELECT album_id AS id FROM tracks WHERE id = ${local}`,
    ).id;
    // Duplicate the lead across and within credit branches; both must deduplicate.
    db.run(
      sql`INSERT INTO track_artists (track_id, artist_id, position) VALUES (${local}, ${lead}, 1), (${local}, ${guest}, 2)`,
    );
    db.run(
      sql`INSERT INTO album_artists (album_id, artist_id, position) VALUES (${album}, ${albumOnly}, 1), (${album}, ${lead}, 2)`,
    );
    db.run(
      sql`UPDATE artists SET sort = CASE WHEN name IN ('Missing only', 'Gone', 'Orphan') THEN '00' ELSE 'tie' END`,
    );
    refreshArtistImages(db);
    const store = await loadLibraryStore(ROOT, db);
    const ids = [
      lead,
      guest,
      albumOnly,
      artistId("Various"),
      artistId("Missing only"),
      artistId("Gone"),
      artistId("Orphan"),
      -1,
      lead,
    ];
    const full = Effect.runSync(store.artistsByIds(ids));
    assert.deepEqual(full, selectArtistsBefore600(db, { ids }));
    assert.deepEqual(
      full.map(({ name, trackCount, albumCount }) => ({ name, trackCount, albumCount })),
      [
        { name: "Missing only", trackCount: 1, albumCount: 1 },
        { name: "Lead", trackCount: 2, albumCount: 2 },
        { name: "Various", trackCount: 1, albumCount: 1 },
        { name: "Guest", trackCount: 2, albumCount: 0 },
        { name: "Album only", trackCount: 2, albumCount: 0 },
      ],
    );
    const leadRow = full.find((row) => row.id === lead)!;
    assert.deepEqual(
      [leadRow.thumbPath, leadRow.artworkPath],
      ["/covers/shared.thumb.jpg", "/covers/shared.jpg"],
    );
    assert.equal(full.find((row) => row.id === albumOnly)!.artworkPath, "/covers/shared.jpg");
    assert.equal(full[0]!.artworkPath, null);
    const emptyRead = traceQueries(db, () => Effect.runSync(store.artistsByIds([])));
    assert.deepEqual(emptyRead.result, []);
    assert.deepEqual(emptyRead.queries, []);
    assert.deepEqual(
      Effect.runSync(store.artistsByIds([-1, artistId("Gone"), artistId("Orphan")])),
      [],
    );
    for (const scope of ["library", "files"] as const) {
      for (const requested of [undefined, ids, [], [-1]]) {
        assert.deepEqual(
          selectArtists(db, { ids: requested, scope }),
          selectArtistsBefore600(db, { ids: requested, scope }),
        );
        for (const offset of [0, 1, 3, 5, 10]) {
          for (const limit of [0, 1, 2, 50]) {
            const page = { offset, limit };
            assert.deepEqual(
              selectArtists(db, { ids: requested, scope, page }),
              selectArtistsBefore600(db, { ids: requested, scope, page }),
            );
          }
        }
      }
    }
    const files = selectArtistsBefore600(db, { scope: "files" });
    assert.deepEqual(
      files.map((row) => [row.name, row.trackCount]),
      [
        ["Lead", 1],
        ["Various", 1],
        ["Guest", 2],
        ["Album only", 1],
      ],
    );
    for (let offset = 0; offset <= files.length; offset++)
      assert.deepEqual(
        Effect.runSync(store.listArtistsPage({ offset, limit: 2 })),
        files.slice(offset, offset + 2),
      );
    assert.deepEqual(selectArtistDetail(db, guest)!.albums, []);
    assert.deepEqual(
      selectArtistDetail(db, guest)!.appearsOn.map((row) => row.title),
      ["Compilation", "Shared"],
    );
    assert.deepEqual(selectArtistDetail(db, albumOnly)!.albums, []);
    assert.deepEqual(
      selectArtistDetail(db, albumOnly)!.appearsOn.map((row) => row.title),
      ["Shared"],
    );
    // A physically deleted artist and a retained artist with no songs both disappear.
    db.run(sql`DELETE FROM albums WHERE album_artist_id = ${artistId("Gone")}`);
    db.run(sql`DELETE FROM artists WHERE name = 'Gone'`);
    assert.deepEqual(Effect.runSync(store.artistsByIds(ids)), full);
  } finally {
    closeTestDatabase(db);
  }
});
