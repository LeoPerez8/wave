/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import {
  normalizeTrack,
  orderKeyBetween,
  type PlayContext,
  type PlaylistSong,
  type UnavailableSong,
  type YtAlbumSong,
} from "@wave/core";
import { eq, sql } from "drizzle-orm";

import type { IndexedTrack } from "../LibraryStore.ts";
import { libraryCounts, sectionSongCounts } from "./counts.ts";
import { creditSplits } from "./credits.ts";
import { recordPlay } from "./playHistory.ts";
import {
  addToPlaylist,
  appendPlaylistSongs,
  createPlaylist,
  deletePlaylist,
  linkPlaylistEntries,
  movePlaylistItem,
  removePlaylistItems,
  renamePlaylist,
  replacePlaylistSongs,
  selectPlaylist,
  selectPlaylistCovers,
  selectPlaylistEntries,
  selectPlaylistEntriesRevision,
  selectPlaylists,
  selectPlaylistsLastPlayed,
  selectPlaylistTotals,
  selectTrackPaths,
} from "./playlists.ts";
import { playlistWork, resetPlaylistWork } from "./playlistWork.ts";
import { saveBatch } from "./save.ts";
import * as schema from "./schema.ts";
import { selectChangesSince, selectPhoneId } from "./sync.ts";
import {
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  type TestDatabase,
} from "./testDatabase.ts";

let db: TestDatabase;
let playlistId: number;
const ids: Record<string, number> = {};

const yt = (videoId: string, fields: Partial<YtAlbumSong> = {}): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Radiohead"],
  album: "OK Computer",
  albumId: "MPREb_ok",
  durationMs: 180_000,
  artworkUrl: `https://lh3.googleusercontent.com/${videoId}`,
  explicit: false,
  ...fields,
});

const library = (title: string): PlaylistSong => ({ source: "library", trackId: ids[title] ?? -1 });
const stream = (song: YtAlbumSong): PlaylistSong => ({ source: "stream", song });
const unavailable = (title: string, fields: Partial<UnavailableSong> = {}): PlaylistSong => ({
  source: "unavailable",
  song: {
    title,
    artists: ["Radiohead"],
    album: "OK Computer",
    durationMs: 180_000,
    artworkUrl: null,
    reason: "notFound",
    ...fields,
  },
});

const newPlaylist = (name: string): number =>
  db
    .insert(schema.playlists)
    .values({ name, createdAt: 0, updatedAt: 0, changedAt: 0 })
    .returning()
    .get().id;

beforeEach(async () => {
  db = await openTestDatabase();
  for (const title of ["Airbag", "Bloom", "Creep", "Daydreaming"]) {
    ids[title] = addTrack(db, { title, album: "Mix", artist: "Radiohead" });
  }
  playlistId = newPlaylist("Drive");
  // Out of title order, with a gap between the order keys.
  const items: [string, number][] = [
    ["Daydreaming", 0],
    ["Airbag", 1],
    ["Creep", 5],
    ["Airbag", 7],
  ];
  for (const [title, position] of items) {
    db.insert(schema.playlistItems)
      .values({
        playlistId,
        trackId: ids[title] ?? -1,
        orderKey: `a${position}`,
        addedAt: 0,
        changedAt: 0,
      })
      .run();
  }
});

/** What the playlist lists, a YT Music entry as `yt:<title>`, an unavailable one as `unavailable:<title>`. */
const titlesOf = (
  id: number,
  page?: { offset: number; limit: number },
  scope?: "library" | "files",
) =>
  selectPlaylistEntries(db, id, page, scope).map((entry) =>
    entry.source === "library"
      ? entry.track.title
      : entry.source === "stream"
        ? `yt:${entry.song.title}`
        : `unavailable:${entry.song.title}`,
  );

const titles = (page?: { offset: number; limit: number }) => titlesOf(playlistId, page);

describe("selectPlaylistEntries", () => {
  test("lists a playlist's songs in playlist order, repeats included", () => {
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag"]);
  });

  test("each row carries its playlist item", () => {
    const items = selectPlaylistEntries(db, playlistId).map((entry) => entry.itemId);
    assert.equal(new Set(items).size, 4);
  });

  test("a page is a window of that order", () => {
    assert.deepEqual(titles({ offset: 1, limit: 2 }), ["Airbag", "Creep"]);
    assert.deepEqual(titles({ offset: 4, limit: 2 }), []);
  });

  test("songs that left the library drop out", () => {
    db.delete(schema.tracks)
      .where(eq(schema.tracks.id, ids.Creep ?? -1))
      .run();
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Airbag"]);
  });

  test("YT Music entries sit among the Library's songs, with what shows them", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    const entries = selectPlaylistEntries(db, playlistId);
    assert.deepEqual(entries.at(-1), {
      itemId: entries.at(-1)?.itemId,
      source: "stream",
      song: yt("a", { title: "Lucky" }),
    });
    assert.deepEqual(titles({ offset: 3, limit: 2 }), ["Airbag", "yt:Lucky"]);
  });
});

describe("appendPlaylistSongs", () => {
  test("Library and YT Music songs go at the end, in the order given", () => {
    const result = appendPlaylistSongs(
      db,
      playlistId,
      [
        stream(yt("a", { title: "Lucky" })),
        library("Bloom"),
        stream(yt("b", { title: "Reckoner" })),
      ],
      0,
    );
    assert.deepEqual(result, { added: 3, alreadyIn: 0 });
    assert.deepEqual(titles(), [
      "Daydreaming",
      "Airbag",
      "Creep",
      "Airbag",
      "yt:Lucky",
      "Bloom",
      "yt:Reckoner",
    ]);
  });

  test("songs the playlist already holds are skipped, a YT Music one by its video id", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a"))], 0);
    const result = appendPlaylistSongs(db, playlistId, [stream(yt("a")), library("Creep")], 0);
    assert.deepEqual(result, { added: 0, alreadyIn: 2 });
  });

  test("decodes only the stored songs the batch could repeat, not the whole playlist", () => {
    appendPlaylistSongs(
      db,
      playlistId,
      ["a", "b", "c", "d", "e"].map((id) => stream(yt(id))),
      0,
    );
    resetPlaylistWork();
    const result = appendPlaylistSongs(
      db,
      playlistId,
      [stream(yt("c")), stream(yt("z")), library("Bloom"), library("Airbag")],
      0,
    );
    assert.deepEqual(result, { added: 2, alreadyIn: 2 });
    assert.equal(playlistWork().decoded.get(playlistId), 1);
    assert.deepEqual(titles().slice(-2), ["yt:Song z", "Bloom"]);
  });

  test("a stored song that can't be read doesn't count as held", () => {
    db.insert(schema.playlistItems)
      .values({
        playlistId,
        ytSong: JSON.stringify({ videoId: "a", title: 7 }),
        orderKey: "a9",
        addedAt: 0,
        changedAt: 0,
      })
      .run();
    assert.deepEqual(appendPlaylistSongs(db, playlistId, [stream(yt("a"))], 0), {
      added: 1,
      alreadyIn: 0,
    });
  });

  test("goes after the last entry, past entries two phones gave one key and removed ones", () => {
    const tied = newPlaylist("Tied");
    const entries: [string, string, string, boolean][] = [
      ["s2", "Creep", "a8", false],
      ["s1", "Airbag", "a8", false],
      ["s3", "Daydreaming", "a9", true],
    ];
    for (const [syncId, title, orderKey, deleted] of entries) {
      db.insert(schema.playlistItems)
        .values({
          playlistId: tied,
          syncId,
          trackId: ids[title] ?? -1,
          orderKey,
          deleted,
          addedAt: 0,
          changedAt: 0,
        })
        .run();
    }
    appendPlaylistSongs(db, tied, [library("Bloom"), library("Daydreaming")], 0);
    assert.deepEqual(titlesOf(tied), ["Airbag", "Creep", "Bloom", "Daydreaming"]);
  });
});

describe("removePlaylistItems", () => {
  const items = () => selectPlaylistEntries(db, playlistId);

  test("removes exactly the given entries; a repeat of the song left unchecked stays", () => {
    const [daydreaming, firstAirbag, creep] = items();
    removePlaylistItems(db, playlistId, [firstAirbag?.itemId ?? -1, creep?.itemId ?? -1], 1000);
    assert.deepEqual(titles(), ["Daydreaming", "Airbag"]);
    assert.equal(items()[0]?.itemId, daydreaming?.itemId);
  });

  test("removes YT Music entries as any other", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    removePlaylistItems(db, playlistId, [items().at(-1)?.itemId ?? -1], 1000);
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag"]);
  });

  test("marks the playlist as edited", () => {
    removePlaylistItems(db, playlistId, [items()[0]?.itemId ?? -1], 1000);
    const playlist = db
      .select()
      .from(schema.playlists)
      .where(eq(schema.playlists.id, playlistId))
      .get();
    assert.equal(playlist?.updatedAt, 1000);
  });

  test("leaves other playlists' entries alone", () => {
    const otherId = newPlaylist("Other");
    removePlaylistItems(
      db,
      otherId,
      items().map((entry) => entry.itemId),
      1000,
    );
    assert.equal(items().length, 4);
  });
});

describe("replacePlaylistSongs", () => {
  test("the playlist then holds exactly the given songs, in that order", () => {
    replacePlaylistSongs(
      db,
      playlistId,
      [library("Creep"), stream(yt("a", { title: "Lucky" })), library("Bloom")],
      1000,
    );
    assert.deepEqual(titles(), ["Creep", "yt:Lucky", "Bloom"]);
  });

  test("marks the playlist as edited and keeps it (and its name)", () => {
    replacePlaylistSongs(db, playlistId, [library("Bloom")], 1000);
    const playlist = db
      .select()
      .from(schema.playlists)
      .where(eq(schema.playlists.id, playlistId))
      .get();
    assert.equal(playlist?.name, "Drive");
    assert.equal(playlist?.updatedAt, 1000);
  });
});

describe("linkPlaylistEntries", () => {
  test("an entry the Library gains becomes that song in the same place, in every playlist", () => {
    const otherId = newPlaylist("Other");
    const lucky = yt("a", { title: "Lucky", durationMs: 259_000 });
    appendPlaylistSongs(db, playlistId, [stream(lucky), library("Bloom")], 0);
    appendPlaylistSongs(db, otherId, [stream(lucky)], 0);
    const before = selectPlaylistEntries(db, playlistId).map((entry) => entry.itemId);

    const luckyId = addTrack(db, { title: "Lucky", artist: "Radiohead", durationMs: 260_000 });
    assert.equal(linkPlaylistEntries(db, 0, [luckyId]), 2);

    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag", "Lucky", "Bloom"]);
    assert.deepEqual(
      selectPlaylistEntries(db, playlistId).map((entry) => entry.itemId),
      before,
    );
    assert.deepEqual(titlesOf(otherId), ["Lucky"]);
  });

  test("a song that isn't the same recording leaves the entry streamed", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    const live = addTrack(db, { title: "Lucky", artist: "Radiohead", durationMs: 320_000 });
    assert.equal(linkPlaylistEntries(db, 0, [live]), 0);
    assert.equal(titles().at(-1), "yt:Lucky");
  });

  test("a scanned or downloaded batch links the entries it brings in", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    saveBatch(db, creditSplits(), [indexedTrack("Lucky", "Radiohead", 180_000)], [], [], 0);
    assert.equal(titles().at(-1), "Lucky");
  });

  test("a scan's batches can leave linking to its end, which links against the whole Library", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    saveBatch(db, creditSplits(), [indexedTrack("Lucky", "Radiohead", 180_000)], [], [], 0, {
      linkEntries: false,
    });
    assert.equal(titles().at(-1), "yt:Lucky");
    assert.equal(linkPlaylistEntries(db, 0), 1);
    assert.equal(titles().at(-1), "Lucky");
  });

  test("an entry whose song its playlist already holds from the Library is dropped, not doubled", () => {
    const luckyId = addTrack(db, { title: "Lucky", artist: "Radiohead", durationMs: 180_000 });
    ids.Lucky = luckyId;
    appendPlaylistSongs(db, playlistId, [library("Lucky"), stream(yt("a", { title: "Lucky" }))], 0);
    linkPlaylistEntries(db, 0, [luckyId]);
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag", "Lucky"]);
  });

  test("of two entries of a playlist that become one Library song, the later is dropped", () => {
    const otherId = newPlaylist("Other");
    const uploads = [yt("a", { title: "Lucky" }), yt("b", { title: "Lucky", durationMs: 181_000 })];
    appendPlaylistSongs(
      db,
      playlistId,
      [stream(uploads[0]!), library("Bloom"), stream(uploads[1]!)],
      0,
    );
    appendPlaylistSongs(db, otherId, [stream(uploads[1]!)], 0);
    const luckyId = addTrack(db, { title: "Lucky", artist: "Radiohead", durationMs: 180_000 });
    linkPlaylistEntries(db, 0, [luckyId]);
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag", "Lucky", "Bloom"]);
    assert.deepEqual(titlesOf(otherId), ["Lucky"]);
  });

  test("the entries' revision rises with any entry written, and not with the Library alone", () => {
    const before = selectPlaylistEntriesRevision(db);
    addTrack(db, { title: "Lucky", artist: "Radiohead" });
    assert.equal(selectPlaylistEntriesRevision(db), before);
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    const added = selectPlaylistEntriesRevision(db);
    assert.ok(added > before);
    // A link that changes nothing leaves it; one that links raises it.
    linkPlaylistEntries(db, 0, []);
    assert.equal(selectPlaylistEntriesRevision(db), added);
    linkPlaylistEntries(db, 0);
    assert.ok(selectPlaylistEntriesRevision(db) > added);
  });

  test("deleting the Library song then takes its entries out, as for any Library song", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    const luckyId = addTrack(db, { title: "Lucky", artist: "Radiohead" });
    linkPlaylistEntries(db, 0, [luckyId]);
    db.delete(schema.tracks).where(eq(schema.tracks.id, luckyId)).run();
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag"]);
  });
});

describe("a Library file leaving", () => {
  test("takes its entries out of playlists; YT Music entries stay", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    db.delete(schema.tracks)
      .where(eq(schema.tracks.id, ids.Airbag ?? -1))
      .run();
    assert.deepEqual(titles(), ["Daydreaming", "Creep", "yt:Lucky"]);
  });
});

describe("selectPlaylistCovers", () => {
  test("a playlist's mosaic takes the covers of what it holds, YT Music's included", () => {
    const id = newPlaylist("Covers");
    const covered = (title: string, hash: string) =>
      addTrack(db, { title, album: title, artist: "Radiohead", artworkHash: hash });
    ids.One = covered("One", "h1");
    ids.Two = covered("Two", "h2");
    appendPlaylistSongs(
      db,
      id,
      [
        library("One"),
        stream(yt("a")),
        library("Two"),
        stream(yt("b", { artworkUrl: null })),
        stream(yt("c")),
      ],
      0,
    );
    assert.deepEqual(selectPlaylistCovers(db, id).get(id), {
      thumbPaths: [
        "/covers/h1.thumb.jpg",
        "https://lh3.googleusercontent.com/a",
        "/covers/h2.thumb.jpg",
        "https://lh3.googleusercontent.com/c",
      ],
      artworkPaths: [
        "/covers/h1.jpg",
        "https://lh3.googleusercontent.com/a",
        "/covers/h2.jpg",
        "https://lh3.googleusercontent.com/c",
      ],
    });
  });

  test("a cover repeated, or an unreadable entry, takes no tile; each playlist gets its own", () => {
    const id = newPlaylist("Repeats");
    const other = newPlaylist("Other");
    for (const [title, hash] of [
      ["One", "h1"],
      ["Two", "h2"],
      ["Three", "h3"],
    ] as const) {
      ids[title] = addTrack(db, { title, album: title, artist: "Radiohead", artworkHash: hash });
    }
    appendPlaylistSongs(db, id, [library("One")], 0);
    db.insert(schema.playlistItems)
      .values({ playlistId: id, ytSong: "not json", orderKey: "a1", addedAt: 0, changedAt: 0 })
      .run();
    // The same cover again, under other songs: one tile.
    db.insert(schema.playlistItems)
      .values({ playlistId: id, trackId: ids.One ?? -1, orderKey: "a2", addedAt: 0, changedAt: 0 })
      .run();
    appendPlaylistSongs(
      db,
      id,
      [stream(yt("a")), stream(yt("a2", { artworkUrl: yt("a").artworkUrl }))],
      0,
    );
    appendPlaylistSongs(db, id, [library("Two"), library("Three")], 0);
    appendPlaylistSongs(db, other, [library("Three")], 0);

    const covers = selectPlaylistCovers(db);
    assert.deepEqual(covers.get(id)?.thumbPaths, [
      "/covers/h1.thumb.jpg",
      "https://lh3.googleusercontent.com/a",
      "/covers/h2.thumb.jpg",
      "/covers/h3.thumb.jpg",
    ]);
    assert.deepEqual(covers.get(other), {
      thumbPaths: ["/covers/h3.thumb.jpg"],
      artworkPaths: ["/covers/h3.jpg"],
    });
  });
});

describe("selectPlaylistTotals", () => {
  test("counts and times every entry, YT Music's included", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { durationMs: 60_000 }))], 0);
    appendPlaylistSongs(db, playlistId, [stream(yt("b", { durationMs: null }))], 0);
    const empty = newPlaylist("Empty");
    const totals = selectPlaylistTotals(db);
    assert.deepEqual(totals.get(playlistId), {
      trackCount: 6,
      durationMs: 4 * 180_000 + 60_000,
      unavailableCount: 0,
    });
    assert.equal(totals.get(empty), undefined);
  });

  test("leaves out an unreadable YT Music entry, as the playlist's list does", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { durationMs: 60_000 }))], 0);
    for (const [position, ytSong] of [
      [10, "not json"],
      [11, JSON.stringify({ videoId: "b", durationMs: 90_000 })],
    ] as const) {
      db.insert(schema.playlistItems)
        .values({ playlistId, ytSong, orderKey: `b${position}`, addedAt: 0, changedAt: 0 })
        .run();
    }
    const entries = selectPlaylistEntries(db, playlistId);
    assert.deepEqual(selectPlaylistTotals(db).get(playlistId), {
      trackCount: entries.length,
      durationMs: 4 * 180_000 + 60_000,
      unavailableCount: 0,
    });
  });
});

describe("unavailable entries", () => {
  test("go in their place among the others, with what the source listed", () => {
    const within = unavailable("Within", { artworkUrl: "https://i.scdn.co/image/w" });
    appendPlaylistSongs(db, playlistId, [within, library("Bloom"), unavailable("Untitled")], 0);
    assert.deepEqual(titles().slice(4), ["unavailable:Within", "Bloom", "unavailable:Untitled"]);
    const entry = selectPlaylistEntries(db, playlistId)[4];
    assert.deepEqual(entry, { itemId: entry?.itemId, ...within });
  });

  test("an unavailable song the playlist holds isn't put in again, as an import going on after a restart gives it", () => {
    appendPlaylistSongs(db, playlistId, [unavailable("Within")], 0);
    const again = appendPlaylistSongs(
      db,
      playlistId,
      [unavailable("Within"), unavailable("Other")],
      0,
    );
    assert.deepEqual(again, { added: 1, alreadyIn: 1 });
  });

  test("count in the playlist's songs and length, and are counted apart as unavailable", () => {
    appendPlaylistSongs(db, playlistId, [unavailable("Within", { durationMs: 60_000 })], 0);
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { durationMs: 30_000 }))], 0);
    const totals = { trackCount: 6, durationMs: 4 * 180_000 + 90_000, unavailableCount: 1 };
    assert.deepEqual(selectPlaylistTotals(db).get(playlistId), totals);
    const page = selectPlaylist(db, playlistId)?.playlist;
    assert.deepEqual(
      [page?.trackCount, page?.durationMs, page?.unavailableCount],
      [6, totals.durationMs, 1],
    );
  });

  test("Android Auto, which lists what can play, leaves them out", () => {
    appendPlaylistSongs(
      db,
      playlistId,
      [unavailable("Within"), stream(yt("a", { title: "Lucky" }))],
      0,
    );
    assert.deepEqual(titlesOf(playlistId, undefined, "files"), [
      "Daydreaming",
      "Airbag",
      "Creep",
      "Airbag",
      "yt:Lucky",
    ]);
    assert.deepEqual(titlesOf(playlistId, { offset: 4, limit: 2 }, "files"), ["yt:Lucky"]);
  });

  test("one the Library gains becomes that song in its place; one it holds already is removed", () => {
    const other = newPlaylist("Other");
    appendPlaylistSongs(db, playlistId, [unavailable("Lucky"), library("Bloom")], 0);
    const luckyId = addTrack(db, { title: "Lucky", artist: "Radiohead", durationMs: 181_000 });
    ids.Lucky = luckyId;
    appendPlaylistSongs(db, other, [library("Lucky"), unavailable("Lucky")], 0);
    assert.equal(linkPlaylistEntries(db, 0, [luckyId]), 2);
    assert.deepEqual(titles().slice(4), ["Lucky", "Bloom"]);
    assert.deepEqual(titlesOf(other), ["Lucky"]);
  });

  test("a scan links them too, against the whole Library", () => {
    appendPlaylistSongs(db, playlistId, [unavailable("Lucky")], 0);
    saveBatch(db, creditSplits(), [indexedTrack("Lucky", "Radiohead", 180_000)], [], [], 0, {
      linkEntries: false,
    });
    assert.equal(linkPlaylistEntries(db, 0), 1);
    assert.equal(titles().at(-1), "Lucky");
  });
});

describe("selectTrackPaths", () => {
  test("lists every track's file with its id, for matching playlist files by path", () => {
    assert.deepEqual(
      selectTrackPaths(db).toSorted((a, b) => a.id - b.id),
      ["Airbag", "Bloom", "Creep", "Daydreaming"].map((title) => ({
        id: ids[title],
        path: `/Music/Mix/${title}.mp3`,
      })),
    );
  });
});

/** The entries changed after [since], as [title, deleted] (the fixture's songs). */
const changedEntries = (since: number) => {
  const titleOf = new Map(
    ["Airbag", "Bloom", "Creep", "Daydreaming"].map((title) => [ids[title], title] as const),
  );
  return selectChangesSince(db, since).entries.map((row) => [
    row.trackId === null ? "yt" : titleOf.get(row.trackId),
    row.deleted,
  ]);
};

describe("movePlaylistItem", () => {
  const itemOf = (index: number) => selectPlaylistEntries(db, playlistId)[index]?.itemId ?? -1;

  test("moves an entry down, up, to the top and to the end", () => {
    movePlaylistItem(db, playlistId, itemOf(0), 2, 1_000);
    assert.deepEqual(titles(), ["Airbag", "Creep", "Daydreaming", "Airbag"]);
    movePlaylistItem(db, playlistId, itemOf(3), 1, 1_001);
    assert.deepEqual(titles(), ["Airbag", "Airbag", "Creep", "Daydreaming"]);
    movePlaylistItem(db, playlistId, itemOf(2), 0, 1_002);
    assert.deepEqual(titles(), ["Creep", "Airbag", "Airbag", "Daydreaming"]);
    movePlaylistItem(db, playlistId, itemOf(0), 9, 1_003);
    assert.deepEqual(titles(), ["Airbag", "Airbag", "Daydreaming", "Creep"]);
  });

  test("changes the moved entry only, stamped by this phone", () => {
    const creep = itemOf(2);
    movePlaylistItem(db, playlistId, creep, 0, 1_000);
    const changes = selectChangesSince(db, 999).entries;
    assert.deepEqual(
      changes.map((row) => [row.itemId, row.changedAt, row.phoneId]),
      [[creep, 1_000, selectPhoneId(db)]],
    );
  });

  test("an entry dropped between two that two phones gave one key lands there", () => {
    // As merging two phones' additions at one place can leave it: Creep and the second Airbag share a key.
    const [daydreaming, airbag, creep, lastAirbag] = selectPlaylistEntries(db, playlistId);
    db.update(schema.playlistItems)
      .set({ orderKey: "a5" })
      .where(eq(schema.playlistItems.id, lastAirbag?.itemId ?? -1))
      .run();
    // The entry ids order the two, whichever comes first.
    const [first, second] = selectPlaylistEntries(db, playlistId).slice(2);
    movePlaylistItem(db, playlistId, daydreaming?.itemId ?? -1, 2, 1_000);
    assert.deepEqual(
      selectPlaylistEntries(db, playlistId).map((entry) => entry.itemId),
      [airbag?.itemId, first?.itemId, daydreaming?.itemId, second?.itemId],
    );
    assert.deepEqual(
      [first?.itemId, second?.itemId].toSorted(),
      [creep?.itemId, lastAirbag?.itemId].toSorted(),
    );
  });
});

describe("tombstones", () => {
  test("removed entries stay as tombstones, stamped by this phone, that nothing lists or counts", () => {
    const [daydreaming, airbag] = selectPlaylistEntries(db, playlistId);
    removePlaylistItems(db, playlistId, [daydreaming?.itemId ?? -1, airbag?.itemId ?? -1], 1_000);
    assert.deepEqual(changedEntries(999), [
      ["Daydreaming", true],
      ["Airbag", true],
    ]);
    assert.ok(
      selectChangesSince(db, 999).entries.every((row) => row.phoneId === selectPhoneId(db)),
    );
    assert.deepEqual(titles(), ["Creep", "Airbag"]);
    assert.equal(selectPlaylistTotals(db, playlistId).get(playlistId)?.trackCount, 2);
    assert.equal(sectionSongCounts(db).playlists, 2);
  });

  test("a song removed from a playlist can be added again", () => {
    removePlaylistItems(
      db,
      playlistId,
      [selectPlaylistEntries(db, playlistId)[2]?.itemId ?? -1],
      1_000,
    );
    assert.deepEqual(appendPlaylistSongs(db, playlistId, [library("Creep")], 1_001), {
      added: 1,
      alreadyIn: 0,
    });
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Airbag", "Creep"]);
  });

  test("replacing a playlist's songs leaves the songs it held as tombstones", () => {
    replacePlaylistSongs(db, playlistId, [library("Bloom")], 1_000);
    assert.deepEqual(changedEntries(999).toSorted(), [
      ["Airbag", true],
      ["Airbag", true],
      ["Bloom", false],
      ["Creep", true],
      ["Daydreaming", true],
    ]);
  });

  test("a deleted playlist and its entries stay as tombstones; it isn't listed or opened, and its name is free", () => {
    deletePlaylist(db, playlistId, 1_000);
    assert.deepEqual(
      selectPlaylists(db).map((row) => row.name),
      [],
    );
    assert.equal(selectPlaylist(db, playlistId), null);
    assert.equal(libraryCounts(db).playlists, 0);
    assert.equal(sectionSongCounts(db).playlists, 0);
    assert.throws(() => addToPlaylist(db, playlistId, [library("Bloom")], 1_001));
    const changes = selectChangesSince(db, 999);
    assert.deepEqual(
      changes.playlists.map((row) => [row.name, row.deleted, row.changedAt]),
      [["Drive", true, 1_000]],
    );
    assert.ok(changes.entries.length === 4 && changes.entries.every((row) => row.deleted));
    createPlaylist(db, "Drive", [], 1_002);
    assert.deepEqual(
      selectPlaylists(db).map((row) => row.name),
      ["Drive"],
    );
  });

  test("a YT Music entry the Library gains is stamped, and one dropped as a double is a tombstone", () => {
    appendPlaylistSongs(
      db,
      playlistId,
      [stream(yt("a", { title: "Lucky" })), stream(yt("b", { title: "Creep" }))],
      0,
    );
    const [lucky, creep] = selectPlaylistEntries(db, playlistId).slice(-2);
    saveBatch(db, creditSplits(), [indexedTrack("Lucky", "Radiohead", 180_000)], [], [], 999, {
      linkEntries: false,
    });
    // The whole Library: Lucky is new, and the playlist holds Creep already.
    linkPlaylistEntries(db, 1_000);
    assert.deepEqual(
      selectChangesSince(db, 999).entries.map((row) => [
        row.itemId,
        row.trackId !== null,
        row.deleted,
      ]),
      [
        // Linked: now the Library's song.
        [lucky?.itemId, true, false],
        // Dropped: the YT Music entry as it was, removed.
        [creep?.itemId, false, true],
      ],
    );
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag", "Lucky"]);
  });
});

describe("playlists made and renamed here", () => {
  test("a new playlist has an id of its own, and its songs order keys in the order given", () => {
    const made = createPlaylist(db, "Mix", [library("Creep"), library("Airbag")], 1_000);
    const changes = selectChangesSince(db, 999);
    assert.deepEqual(
      changes.playlists.map((row) => [row.id, row.name, row.deleted]),
      [[made.playlistId, "Mix", false]],
    );
    assert.match(changes.playlists[0]?.syncId ?? "", /^[0-9a-f]{32}$/);
    assert.deepEqual(
      changes.entries.map((row) => row.orderKey),
      [orderKeyBetween(null, null), orderKeyBetween(orderKeyBetween(null, null), null)],
    );
    assert.deepEqual(titlesOf(made.playlistId), ["Creep", "Airbag"]);
  });

  test("renaming stamps the playlist; two changes in one millisecond still get two times", () => {
    renamePlaylist(db, playlistId, "Night Drive", 1_000);
    renamePlaylist(db, playlistId, "Late Drive", 1_000);
    assert.deepEqual(
      selectChangesSince(db, 999).playlists.map((row) => [row.name, row.changedAt]),
      [["Late Drive", 1_001]],
    );
  });
});

/** Plays started from playlist [id]. */
const fromPlaylist = (id: number): PlayContext => ({ kind: "playlist", id: String(id) });

describe("sorting the Playlists list", () => {
  test("each playlist is listed with when it was made", () => {
    const made = createPlaylist(db, "Mix", [], 4_000);
    assert.deepEqual(
      selectPlaylists(db).map((row) => [row.name, row.createdAt]),
      [
        ["Drive", 0],
        ["Mix", 4_000],
      ],
    );
    assert.equal(selectPlaylist(db, made.playlistId)?.playlist.createdAt, 4_000);
  });

  test("a playlist last played when the latest song played from it started", () => {
    const other = newPlaylist("Other");
    newPlaylist("Never played");
    const play = (title: string, startedAt: number, context: PlayContext | null) =>
      recordPlay(db, {
        trackId: String(ids[title]),
        context,
        startedAt,
        listenedMs: 1_000,
        durationMs: 180_000,
        endReason: "skipped",
        counted: false,
        source: "phone",
      });
    play("Airbag", 1_000, fromPlaylist(playlistId));
    play("Creep", 5_000, fromPlaylist(playlistId));
    play("Bloom", 3_000, fromPlaylist(other));
    // Played from elsewhere: an album, Play Next.
    play("Bloom", 9_000, { kind: "album", id: String(playlistId) });
    play("Creep", 9_500, null);
    assert.deepEqual(
      selectPlaylistsLastPlayed(db),
      new Map([
        [playlistId, 5_000],
        [other, 3_000],
      ]),
    );
  });
});

describe("migration 0016", () => {
  test("playlists from before YT Music entries come through unchanged", async () => {
    const old = await openTestDatabase({ through: "0015_tag_credits" });
    const a = addTrack(old, { title: "Airbag", album: "Mix", artist: "Radiohead" });
    const b = addTrack(old, { title: "Bloom", album: "Mix", artist: "Radiohead" });
    const id = old.get<{ id: number }>(
      sql`INSERT INTO playlists (name, created_at, updated_at) VALUES ('Old', 0, 0) RETURNING id`,
    ).id;
    for (const [trackId, position] of [
      [b, 0],
      [a, 3],
      [b, 4],
    ] as const) {
      old.run(
        sql`INSERT INTO playlist_items (playlist_id, track_id, position, added_at) VALUES (${id}, ${trackId}, ${position}, 0)`,
      );
    }
    const itemIds = old
      .all<{ id: number }>(sql`SELECT id FROM playlist_items ORDER BY position`)
      .map((row) => row.id);

    await migrateTestDatabase(old);

    const entries = selectPlaylistEntries(old, id);
    assert.deepEqual(
      entries.map((entry) => (entry.source === "library" ? entry.track.title : "yt")),
      ["Bloom", "Airbag", "Bloom"],
    );
    assert.deepEqual(
      entries.map((entry) => entry.itemId),
      itemIds,
    );
    // New entries keep counting on from the old ones.
    appendPlaylistSongs(old, id, [{ source: "stream", song: yt("a") }], 0);
    const last = selectPlaylistEntries(old, id).at(-1)?.itemId ?? 0;
    assert.ok(last > Math.max(...itemIds));
  });
});

/** A track as the scanner reports it, for saving a batch. */
const indexedTrack = (title: string, artist: string, durationMs: number): IndexedTrack => ({
  ...normalizeTrack({ path: `/Music/New/${title}.mp3`, title, artist, album: "New", durationMs }),
  sizeBytes: 1_000,
  modifiedAt: 0,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
});
