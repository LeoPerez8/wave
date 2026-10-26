/// <reference types="node" />
import {
  albumPlayTotals,
  artistPlayTotals,
  artistStats,
  statsWindow,
  storedGenres,
  type PlayEvent,
  type SongListening,
} from "@wave/core";
import { eq, sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { creditSplits, relinkCredits } from "./credits.ts";
import { recordPlay } from "./playHistory.ts";
import { removeTracks } from "./save.ts";
import * as schema from "./schema.ts";
import {
  artistFirstPlays,
  artistPlays,
  countedListening,
  creditedPlayTotals,
  songGenres,
  songListening,
  songsCrediting,
  trackPlayTotals,
} from "./stats.ts";
import {
  addHistory,
  addTrack,
  openTestDatabase,
  traceQueries,
  type TestDatabase,
} from "./testDatabase.ts";
import { deleteTracks } from "./tracks.ts";

/** A counted play of `trackId` that started at `startedAt`. */
const play = (
  trackId: number,
  startedAt: number,
  overrides: Partial<PlayEvent> = {},
): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt,
  listenedMs: 180_000,
  durationMs: 180_000,
  endReason: "completed",
  counted: true,
  source: "phone",
  ...overrides,
});

const skip = { endReason: "skipped", listenedMs: 10_000, counted: false } as const;

let db: TestDatabase;

/** Deletes the tracks as the store does when their files go (deleted, or gone from a scan). */
const deleteSongs = (...ids: number[]): void => {
  const paths = ids.map((id) => {
    const track = db.select().from(schema.tracks).where(eq(schema.tracks.id, id)).get();
    if (track?.path == null) throw new Error(`no track ${id} with a file`);
    return track.path;
  });
  deleteTracks(db, paths);
};

beforeEach(async () => {
  db = await openTestDatabase();
});

/** The id of the artist named `name`. */
const artistNamed = (name: string): number => {
  const artist = db.select().from(schema.artists).where(eq(schema.artists.name, name)).get();
  if (artist === undefined) throw new Error(`no artist ${name}`);
  return artist.id;
};

/**
 * Adds the tracks, then files every track under the artists its credit names,
 * as a scan's end does; returns the tracks' ids.
 */
const addCredited = (...tracks: Parameters<typeof addTrack>[1][]): number[] => {
  const ids = tracks.map((track) => addTrack(db, track));
  relinkCredits(db, creditSplits());
  return ids;
};

const byId = (rows: ReturnType<typeof trackPlayTotals>) => rows.toSorted((a, b) => a.id - b.id);

describe("Per-track play totals", () => {
  test("sum each track's counted plays, listened time and latest counted play", () => {
    const blue = addTrack(db, { title: "Blue in Green" });
    const so = addTrack(db, { title: "So What" });
    addTrack(db, { title: "Never played" });
    recordPlay(db, play(blue, 1_000, { listenedMs: 100_000 }));
    recordPlay(db, play(blue, 3_000, { listenedMs: 200_000 }));
    recordPlay(db, play(so, 2_000, { listenedMs: 150_000 }));

    assert.deepEqual(byId(trackPlayTotals(db, { from: null, to: 10_000 })), [
      {
        id: blue,
        sortKey: "blue in green",
        countedPlays: 2,
        listenedMs: 300_000,
        latestPlayAt: 3_000,
      },
      { id: so, sortKey: "so what", countedPlays: 1, listenedMs: 150_000, latestPlayAt: 2_000 },
    ]);
  });

  test("only counted plays count: skips add neither plays, time nor recency", () => {
    const track = addTrack(db, { title: "Sampled" });
    const never = addTrack(db, { title: "Only skipped" });
    recordPlay(db, play(track, 1_000));
    recordPlay(db, play(track, 5_000, skip));
    recordPlay(db, play(never, 2_000, skip));

    assert.deepEqual(trackPlayTotals(db, { from: null, to: 10_000 }), [
      { id: track, sortKey: "sampled", countedPlays: 1, listenedMs: 180_000, latestPlayAt: 1_000 },
    ]);
  });

  test("count plays started from the window's start up to its end, both included", () => {
    const track = addTrack(db, { title: "Edges" });
    recordPlay(db, play(track, 999));
    recordPlay(db, play(track, 1_000));
    recordPlay(db, play(track, 2_000));
    recordPlay(db, play(track, 2_001));

    const [totals] = trackPlayTotals(db, { from: 1_000, to: 2_000 });
    assert.equal(totals?.countedPlays, 2);
    assert.equal(totals?.latestPlayAt, 2_000);
  });

  test("with track ids, only those tracks' totals, however many are asked for", () => {
    const blue = addTrack(db, { title: "Blue in Green" });
    const so = addTrack(db, { title: "So What" });
    const other = addTrack(db, { title: "Not asked" });
    for (const track of [blue, blue, so, other]) recordPlay(db, play(track, 1_000));
    const totals = (ids: readonly number[]) =>
      byId(trackPlayTotals(db, { from: null, to: 10_000 }, ids)).map((row) => [
        row.id,
        row.countedPlays,
      ]);

    assert.deepEqual(totals([blue, so]), [
      [blue, 2],
      [so, 1],
    ]);
    assert.deepEqual(totals([]), []);
    // More ids than one statement binds.
    const many = [...Array.from({ length: 1_200 }, (_, i) => 1_000_000 + i), other];
    assert.deepEqual(totals(many), [[other, 1]]);
  });

  test("an empty window has no totals", () => {
    const track = addTrack(db, { title: "Long ago" });
    recordPlay(db, play(track, 1_000));
    assert.deepEqual(trackPlayTotals(db, { from: 5_000, to: 10_000 }), []);
  });

  test("tracks that left the library drop out", () => {
    const gone = addTrack(db, { title: "Deleted" });
    const kept = addTrack(db, { title: "Kept" });
    recordPlay(db, play(gone, 1_000));
    recordPlay(db, play(kept, 2_000));
    db.delete(schema.tracks).where(eq(schema.tracks.id, gone)).run();

    assert.deepEqual(
      trackPlayTotals(db, { from: null, to: 10_000 }).map((row) => row.id),
      [kept],
    );
  });
});

/** The album and track artist of `trackId`. */
const creditOf = (trackId: number) => {
  const track = db.select().from(schema.tracks).where(eq(schema.tracks.id, trackId)).get();
  if (track === undefined) throw new Error(`no track ${trackId}`);
  return { albumId: track.albumId, artistId: track.artistId };
};

const byCredit = (rows: ReturnType<typeof creditedPlayTotals>) =>
  rows.toSorted((a, b) => a.albumId - b.albumId || a.artistId - b.artistId);

describe("Per-album, per-track-artist play totals", () => {
  test("sum counted plays per album and track artist, crediting a compilation's real artists", () => {
    const so = addTrack(db, { title: "So What", artist: "Miles Davis", album: "Kind of Blue" });
    const blue = addTrack(db, {
      title: "Blue in Green",
      artist: "Miles Davis",
      album: "Kind of Blue",
    });
    const milesOnHits = addTrack(db, {
      title: "Milestones",
      artist: "Miles Davis",
      album: "Jazz Hits",
      albumArtist: "Various Artists",
    });
    const trane = addTrack(db, {
      title: "Naima",
      artist: "John Coltrane",
      album: "Jazz Hits",
      albumArtist: "Various Artists",
    });
    recordPlay(db, play(so, 1_000, { listenedMs: 100_000 }));
    recordPlay(db, play(blue, 4_000, { listenedMs: 200_000 }));
    recordPlay(db, play(milesOnHits, 2_000, { listenedMs: 150_000 }));
    recordPlay(db, play(trane, 3_000, { listenedMs: 120_000 }));
    recordPlay(db, play(trane, 5_000, { listenedMs: 130_000 }));

    const kindOfBlue = creditOf(so);
    const hitsMiles = creditOf(milesOnHits);
    const hitsTrane = creditOf(trane);
    assert.equal(hitsMiles.artistId, kindOfBlue.artistId);

    assert.deepEqual(
      byCredit(creditedPlayTotals(db, { from: null, to: 10_000 })),
      byCredit([
        {
          ...kindOfBlue,
          albumSort: "kind of blue",
          artistSort: "miles davis",
          primary: true,
          countedPlays: 2,
          listenedMs: 300_000,
          latestPlayAt: 4_000,
        },
        {
          ...hitsMiles,
          albumSort: "jazz hits",
          artistSort: "miles davis",
          primary: true,
          countedPlays: 1,
          listenedMs: 150_000,
          latestPlayAt: 2_000,
        },
        {
          ...hitsTrane,
          albumSort: "jazz hits",
          artistSort: "john coltrane",
          primary: true,
          countedPlays: 2,
          listenedMs: 250_000,
          latestPlayAt: 5_000,
        },
      ]),
    );
  });

  test("only counted plays within the window count, both ends included", () => {
    const track = addTrack(db, { title: "Edges", artist: "Edgar", album: "Bounds" });
    const skipped = addTrack(db, { title: "Skipped", artist: "Skipper", album: "Skips" });
    recordPlay(db, play(track, 999));
    recordPlay(db, play(track, 1_000));
    recordPlay(db, play(track, 1_500, skip));
    recordPlay(db, play(track, 2_000));
    recordPlay(db, play(track, 2_001));
    recordPlay(db, play(skipped, 1_500, skip));

    const rows = creditedPlayTotals(db, { from: 1_000, to: 2_000 });
    assert.deepEqual(
      rows.map((row) => [row.albumSort, row.countedPlays, row.latestPlayAt]),
      [["bounds", 2, 2_000]],
    );
    assert.deepEqual(creditedPlayTotals(db, { from: 5_000, to: 10_000 }), []);
  });

  test("a deleted song's plays still count for its album and track artist", () => {
    const gone = addTrack(db, { title: "Deleted", artist: "Ghost", album: "Here" });
    const kept = addTrack(db, { title: "Kept", artist: "Keeper", album: "Here" });
    recordPlay(db, play(gone, 1_000));
    recordPlay(db, play(gone, 3_000, skip));
    recordPlay(db, play(kept, 2_000));
    const all = { from: null, to: 10_000 };
    const before = creditedPlayTotals(db, all);

    deleteSongs(gone);

    assert.deepEqual(byCredit(creditedPlayTotals(db, all)), byCredit(before));
    assert.deepEqual(
      byCredit(creditedPlayTotals(db, all)).map((row) => [row.artistSort, row.countedPlays]),
      [
        ["ghost", 1],
        ["keeper", 1],
      ],
    );
  });

  test("a collaboration's plays count for each artist it credits, and once for its album", () => {
    const [motive, rings] = addCredited(
      {
        title: "motive",
        artist: "Ariana Grande, Doja Cat",
        album: "Positions",
        albumArtist: "Ariana Grande",
      },
      { title: "34+35", artist: "Ariana Grande", album: "Positions" },
    ) as [number, number];
    recordPlay(db, play(motive, 1_000, { listenedMs: 100_000 }));
    recordPlay(db, play(motive, 2_000, { listenedMs: 100_000 }));
    recordPlay(db, play(rings, 3_000, { listenedMs: 50_000 }));
    const credits = creditedPlayTotals(db, { from: null, to: 10_000 });

    assert.deepEqual(
      artistPlayTotals(credits)
        .map((artist) => [artist.sortKey, artist.countedPlays, artist.listenedMs])
        .toSorted(),
      [
        ["ariana grande", 3, 250_000],
        ["doja cat", 2, 200_000],
      ],
    );
    assert.deepEqual(
      albumPlayTotals(credits).map((album) => [
        album.sortKey,
        album.countedPlays,
        album.listenedMs,
      ]),
      [["positions", 3, 250_000]],
    );
  });

  test("a deleted collaboration's plays still count for each of its artists, and once for its album", () => {
    const [motive] = addCredited(
      { title: "motive", artist: "Ariana Grande, Doja Cat", album: "Positions" },
      { title: "34+35", artist: "Ariana Grande", album: "Positions" },
      { title: "Say So", artist: "Doja Cat", album: "Hot Pink" },
    ) as [number];
    recordPlay(db, play(motive, 1_000));
    recordPlay(db, play(motive, 2_000));
    const all = { from: null, to: 10_000 };
    const before = creditedPlayTotals(db, all);

    deleteSongs(motive);

    assert.deepEqual(byCredit(creditedPlayTotals(db, all)), byCredit(before));
    assert.deepEqual(
      artistPlayTotals(creditedPlayTotals(db, all))
        .map((artist) => [artist.sortKey, artist.countedPlays])
        .toSorted(),
      [
        ["ariana grande", 2],
        ["doja cat", 2],
      ],
    );
    assert.deepEqual(
      albumPlayTotals(creditedPlayTotals(db, all)).map((album) => album.countedPlays),
      [2],
    );
  });

  test("a deleted collaboration whose primary artist left the library still counts for the others and its album", () => {
    const [motive] = addCredited(
      {
        title: "motive",
        artist: "Ariana Grande, Doja Cat",
        album: "Hot Pink",
        albumArtist: "Doja Cat",
      },
      { title: "Say So", artist: "Doja Cat", album: "Hot Pink" },
    ) as [number];
    recordPlay(db, play(motive, 1_000));
    const path = db.select().from(schema.tracks).where(eq(schema.tracks.id, motive)).get()?.path;

    // Ariana's only song goes, and she with it.
    removeTracks(db, creditSplits(), [path ?? ""]);

    const credits = creditedPlayTotals(db, { from: null, to: 10_000 });
    assert.deepEqual(
      artistPlayTotals(credits).map((artist) => [artist.sortKey, artist.countedPlays]),
      [["doja cat", 1]],
    );
    assert.deepEqual(
      albumPlayTotals(credits).map((album) => [album.sortKey, album.countedPlays]),
      [["hot pink", 1]],
    );
  });

  test("an album or artist that left the library drops out", () => {
    const gone = addTrack(db, { title: "Deleted", artist: "Ghost", album: "Gone" });
    const kept = addTrack(db, { title: "Kept", artist: "Keeper", album: "Here" });
    recordPlay(db, play(gone, 1_000));
    recordPlay(db, play(kept, 2_000));
    deleteSongs(gone);
    db.run(sql`DELETE FROM albums WHERE id NOT IN (SELECT album_id FROM tracks)`);

    assert.deepEqual(
      creditedPlayTotals(db, { from: null, to: 10_000 }).map((row) => row.artistSort),
      ["keeper"],
    );
  });
});

const byTrack = (rows: readonly SongListening[]) => rows.toSorted((a, b) => a.trackId - b.trackId);

describe("Per-song listening over all time", () => {
  test("sum every play's time, the counted plays and the latest play, with the song's artists", () => {
    const so = addTrack(db, { title: "So What", artist: "Miles Davis" });
    const naima = addTrack(db, { title: "Naima", artist: "John Coltrane" });
    addTrack(db, { title: "Never played" });
    recordPlay(db, play(so, 1_000, { listenedMs: 100_000 }));
    recordPlay(db, play(so, 3_000, skip));
    recordPlay(db, play(naima, 2_000, skip));

    assert.deepEqual(byTrack(songListening(db)), [
      {
        trackId: so,
        artistIds: [creditOf(so).artistId],
        inLibrary: true,
        countedPlays: 1,
        listenedMs: 110_000,
        lastPlayedAt: 3_000,
      },
      {
        trackId: naima,
        artistIds: [creditOf(naima).artistId],
        inLibrary: true,
        countedPlays: 0,
        listenedMs: 10_000,
        lastPlayedAt: 2_000,
      },
    ]);
  });

  test("a deleted song keeps its history and its artists", () => {
    const gone = addTrack(db, { title: "Deleted", artist: "Ghost" });
    recordPlay(db, play(gone, 1_000));
    recordPlay(db, play(gone, 2_000));
    const { artistId } = creditOf(gone);
    deleteSongs(gone);

    assert.deepEqual(songListening(db), [
      {
        trackId: gone,
        artistIds: [artistId],
        inLibrary: false,
        countedPlays: 2,
        listenedMs: 360_000,
        lastPlayedAt: 2_000,
      },
    ]);
  });

  test("a collaboration keeps every artist its credit names, in the library and once deleted", () => {
    const [motive, gone] = addCredited(
      { title: "motive", artist: "Ariana Grande, Doja Cat", album: "Positions" },
      { title: "boyfriend", artist: "Ariana Grande · Social House", album: "boyfriend" },
      // A song of her own, so her collaborations split.
      { title: "34+35", artist: "Ariana Grande", album: "Positions" },
    ) as [number, number];
    recordPlay(db, play(motive, 1_000));
    recordPlay(db, play(gone, 2_000));
    deleteSongs(gone);

    assert.deepEqual(
      byTrack(songListening(db)).map((song) => [song.trackId, song.artistIds, song.inLibrary]),
      [
        [motive, [artistNamed("Ariana Grande"), artistNamed("Doja Cat")], true],
        [gone, [artistNamed("Ariana Grande"), artistNamed("Social House")], false],
      ],
    );
  });

  test("a song that left the library before Wave kept credits has no artist", () => {
    const gone = addTrack(db, { title: "Deleted" });
    recordPlay(db, play(gone, 1_000));
    db.delete(schema.tracks).where(eq(schema.tracks.id, gone)).run();

    assert.deepEqual(songListening(db), [
      {
        trackId: gone,
        artistIds: [],
        inLibrary: false,
        countedPlays: 1,
        listenedMs: 180_000,
        lastPlayedAt: 1_000,
      },
    ]);
  });
});

describe("Artist page stats", () => {
  test("agree with the artist's plays in Stats (all time), crediting compilations by track artist", () => {
    const so = addTrack(db, { title: "So What", artist: "Miles Davis", album: "Kind of Blue" });
    addTrack(db, {
      title: "Blue in Green",
      artist: "Miles Davis",
      album: "Kind of Blue",
    });
    const milesOnHits = addTrack(db, {
      title: "Milestones",
      artist: "Miles Davis",
      album: "Jazz Hits",
      albumArtist: "Various Artists",
    });
    const trane = addTrack(db, {
      title: "Naima",
      artist: "John Coltrane",
      album: "Jazz Hits",
      albumArtist: "Various Artists",
    });
    const gone = addTrack(db, { title: "Deleted", artist: "Miles Davis", album: "Kind of Blue" });
    recordPlay(db, play(so, 1_000));
    recordPlay(db, play(so, 2_000));
    recordPlay(db, play(so, 3_000, skip));
    recordPlay(db, play(milesOnHits, 4_000));
    recordPlay(db, play(trane, 5_000));
    recordPlay(db, play(gone, 6_000));
    deleteSongs(gone);

    const miles = creditOf(so).artistId;
    const all = { from: null, to: 10_000 };
    const stats = artistStats({ artistId: miles, now: 10_000, ...artistPlays(db, miles, 10_000) });
    const inStats = artistPlayTotals(creditedPlayTotals(db, all)).find((a) => a.id === miles);

    // The deleted song's play still counts, on the page as in Stats.
    assert.equal(inStats?.countedPlays, 4);
    assert.ok(stats.played);
    assert.equal(stats.plays, "4 plays");
    assert.equal(stats.songsListened, "2 of 3 songs");
    assert.deepEqual(
      stats.mostPlayed.map((song) => song.id),
      [so, milesOnHits],
    );
  });

  test("credit a collaboration to each of its artists, counting songs listened out of the songs crediting them", () => {
    const [motive, rings, gone] = addCredited(
      {
        title: "motive",
        artist: "Ariana Grande, Doja Cat",
        album: "Positions",
        albumArtist: "Ariana Grande",
      },
      { title: "34+35", artist: "Ariana Grande", album: "Positions" },
      { title: "Kiss Me More", artist: "Doja Cat feat. SZA", album: "Planet Her" },
      // On Ariana's album, so on her page, but not credited to her.
      {
        title: "Off the Table (Doja's mix)",
        artist: "Doja Cat",
        album: "Positions",
        albumArtist: "Ariana Grande",
      },
    ) as [number, number, number];
    recordPlay(db, play(motive, 1_000));
    recordPlay(db, play(motive, 2_000));
    recordPlay(db, play(rings, 3_000, skip));
    recordPlay(db, play(gone, 4_000));
    deleteSongs(gone);
    const all = { from: null, to: 10_000 };
    const page = (name: string) => {
      const artistId = artistNamed(name);
      const stats = artistStats({ artistId, now: 10_000, ...artistPlays(db, artistId, 10_000) });
      return stats.played
        ? [stats.plays, stats.songsListened, stats.mostPlayed.map((song) => song.id)]
        : [];
    };
    const inStats = artistPlayTotals(creditedPlayTotals(db, all)).map(
      (artist) => [artist.sortKey, artist.countedPlays] as const,
    );

    assert.deepEqual(page("Ariana Grande"), ["2 plays", "1 of 2 songs", [motive]]);
    assert.deepEqual(page("Doja Cat"), ["3 plays", "1 of 2 songs", [motive]]);
    assert.deepEqual(page("SZA"), ["1 play", "0 of 0 songs", []]);
    assert.deepEqual(inStats.toSorted(), [
      ["ariana grande", 2],
      ["doja cat", 3],
      ["sza", 1],
    ]);
  });
});

/** The id of the song titled `title`. */
const songTitled = (title: string): number => {
  const track = db.select().from(schema.tracks).where(eq(schema.tracks.title, title)).get();
  if (track === undefined) throw new Error(`no song ${title}`);
  return track.id;
};

const everyArtist = () => db.select({ id: schema.artists.id }).from(schema.artists).all();

/** The plan steps that read a whole table the history or the credits live in. */
const wholeTableReads = (plan: readonly string[]) =>
  plan.filter((step) =>
    /^SCAN (play_events|tracks|track_artists|deleted_track_artists)\b/.test(step),
  );

describe("One artist's plays", () => {
  const now = 100_000;

  /** The stats block as the page read it before: from the whole history. */
  const fromWholeHistory = (artistId: number) =>
    artistStats({
      artistId,
      songIds: songsCrediting(db, artistId),
      listening: songListening(db),
      songPlays: trackPlayTotals(db, statsWindow("all", now)),
      now,
    });

  /** The stats block from the artist's own plays. */
  const fromArtistPlays = (artistId: number) =>
    artistStats({ artistId, now, ...artistPlays(db, artistId, now) });

  /**
   * Collaborations, compilations, songs deleted with and without their kept
   * credits, skips, ties, a play stamped after `now` and an unplayed artist.
   */
  const seedLibrary = () => {
    addCredited(
      { title: "So What", artist: "Miles Davis", album: "Kind of Blue" },
      { title: "Blue in Green", artist: "Miles Davis", album: "Kind of Blue" },
      {
        title: "Milestones",
        artist: "Miles Davis",
        album: "Jazz Hits",
        albumArtist: "Various Artists",
      },
      { title: "Freddie Freeloader", artist: "Miles Davis", album: "Kind of Blue" },
      { title: "All Blues", artist: "Miles Davis", album: "Kind of Blue" },
      {
        title: "motive",
        artist: "Ariana Grande, Doja Cat",
        album: "Positions",
        albumArtist: "Ariana Grande",
      },
      { title: "34+35", artist: "Ariana Grande", album: "Positions" },
      { title: "boyfriend", artist: "Ariana Grande · Social House", album: "boyfriend" },
      { title: "Early", artist: "Miles Davis", album: "Birth of the Cool" },
      {
        title: "Naima",
        artist: "John Coltrane",
        album: "Jazz Hits",
        albumArtist: "Various Artists",
      },
      { title: "Only skipped", artist: "Cannonball Adderley", album: "Somethin' Else" },
      { title: "Never played", artist: "Bill Evans", album: "Portrait in Jazz" },
    );
    const plays: [string, number, Partial<PlayEvent>?][] = [
      ["So What", 1_000],
      ["So What", 2_000],
      ["So What", 3_000, skip],
      // Milestones and Freddie tie on plays and time; Freddie was played last.
      ["Milestones", 4_000],
      ["Freddie Freeloader", 5_000],
      // All Blues ties with Milestones on everything up to now but the title.
      ["All Blues", 4_000],
      // Stamped after now: listening counts it, the ranking's window doesn't.
      ["All Blues", now + 5_000],
      ["motive", 6_000],
      ["motive", 7_000],
      ["34+35", 8_000, skip],
      ["boyfriend", 9_000],
      ["Early", 10_000],
      ["Naima", 11_000],
      ["Only skipped", 12_000, skip],
    ];
    for (const [title, startedAt, overrides] of plays) {
      recordPlay(db, play(songTitled(title), startedAt, overrides));
    }
    // Deleted with its credits kept, and as before Wave kept them.
    deleteSongs(songTitled("boyfriend"));
    db.delete(schema.tracks)
      .where(eq(schema.tracks.id, songTitled("Early")))
      .run();
  };

  test("read the same stats block as the whole history, for every artist", () => {
    seedLibrary();

    for (const { id } of everyArtist()) {
      assert.deepEqual(fromArtistPlays(id), fromWholeHistory(id), `artist ${id}`);
    }
  });

  test("hold the listening of exactly the songs whose credit names the artist", () => {
    seedLibrary();

    for (const { id } of everyArtist()) {
      assert.deepEqual(
        byTrack(artistPlays(db, id, now).listening),
        byTrack(songListening(db).filter((song) => song.artistIds.includes(id))),
        `artist ${id}`,
      );
    }
  });

  test("find the artist's songs and their plays through indexes, never reading a whole table", () => {
    seedLibrary();
    const { queries } = traceQueries(db, () => artistPlays(db, artistNamed("Miles Davis"), now));

    for (const query of queries) assert.deepEqual(wholeTableReads(query.plan), [], query.sql);
    const plans = queries.flatMap((query) => query.plan);
    for (const index of [
      "track_artists_artist_idx",
      "deleted_track_artists_artist_idx",
      "play_events_track_idx",
    ]) {
      assert.ok(
        plans.some((step) => step.startsWith("SEARCH") && step.includes(index)),
        `${index} in ${plans.join("; ")}`,
      );
    }
  });

  test("read the same rows however much of the history is other artists'", () => {
    seedLibrary();
    const miles = artistNamed("Miles Davis");
    const read = () => traceQueries(db, () => artistPlays(db, miles, now));
    const before = read();

    addHistory(db, { artist: "Herbie Hancock", tracks: 2_000, plays: 30_000 });
    addHistory(db, { artist: "Wayne Shorter", tracks: 500, plays: 10_000 });
    const after = read();

    assert.deepEqual(after.result, before.result);
    assert.deepEqual(
      after.queries.map((query) => query.rows),
      before.queries.map((query) => query.rows),
    );
    assert.equal(after.queries.length, 3);
  });
});

describe("Recap genres and discoveries", () => {
  test("each song's genre tag, every value of a multi-value one; no genre is null", () => {
    const [rock, multi, none] = addCredited(
      { title: "Rock song", genre: "Rock" },
      { title: "Multi song", genre: "Metalcore" },
      { title: "No genre" },
    );
    if (rock === undefined || multi === undefined || none === undefined) {
      throw new Error("tracks not added");
    }
    db.update(schema.tracks)
      .set({ genres: storedGenres(["Metalcore", "Rock"]) })
      .where(eq(schema.tracks.id, multi))
      .run();

    assert.deepEqual(
      songGenres(db, [rock, multi, none]).toSorted((a, b) => Number(a.id) - Number(b.id)),
      [
        { id: rock, genre: "Rock", genres: null },
        { id: multi, genre: "Metalcore", genres: ["Metalcore", "Rock"] },
        { id: none, genre: null, genres: null },
      ].toSorted((a, b) => a.id - b.id),
    );
  });

  test("each artist's first counted play ever, deleted songs' credits included", () => {
    const [early, late, gone] = addCredited(
      { title: "Early", artist: "A" },
      { title: "Late", artist: "B" },
      { title: "Gone", artist: "A" },
    );
    if (early === undefined || late === undefined || gone === undefined) {
      throw new Error("tracks not added");
    }
    recordPlay(db, play(gone, 1_000));
    recordPlay(db, play(early, 5_000));
    recordPlay(db, play(late, 2_000, skip));
    recordPlay(db, play(late, 9_000));
    deleteSongs(gone);
    const [a, b] = [artistNamed("A"), artistNamed("B")];

    assert.deepEqual(
      artistFirstPlays(db, [a, b]).toSorted((x, y) => Number(x.id) - Number(y.id)),
      [
        { id: a, firstPlayAt: 1_000 },
        { id: b, firstPlayAt: 9_000 },
      ].toSorted((x, y) => x.id - y.id),
    );
  });
});

describe("Counted listening for Recaps", () => {
  const QUARTER = 15 * 60_000;

  test("sums counted plays per quarter hour, deleted songs included, skips left out", () => {
    const [kept, gone] = addCredited(
      { title: "Kept", artist: "A" },
      { title: "Gone", artist: "B" },
    );
    if (kept === undefined || gone === undefined) throw new Error("tracks not added");
    recordPlay(db, play(kept, 10 * QUARTER + 1_000, { listenedMs: 100_000 }));
    recordPlay(db, play(gone, 10 * QUARTER + 5_000, { listenedMs: 200_000 }));
    recordPlay(db, play(kept, 10 * QUARTER + 9_000, skip));
    recordPlay(db, play(kept, 12 * QUARTER, { listenedMs: 50_000 }));
    deleteSongs(gone);

    assert.deepEqual(
      countedListening(db).toSorted((a, b) => a.startedAt - b.startedAt),
      [
        { startedAt: 10 * QUARTER, listenedMs: 300_000 },
        { startedAt: 12 * QUARTER, listenedMs: 50_000 },
      ],
    );
  });
});
