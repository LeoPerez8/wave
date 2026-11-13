import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { EMPTY_QUEUE, reduceQueue } from "@wave/core";
import type { DiscoverMix } from "@wave/core";
import { readQueueContinuationSeed } from "./queueContinuationSeed.ts";
import { selectAlbumDetail, selectAlbums } from "../library/db/albums.ts";
import { selectArtistDetail, selectArtists } from "../library/db/artists.ts";
import { selectPlayableSongs } from "../library/db/tracks.ts";
import { selectPlaylist, createPlaylist } from "../library/db/playlists.ts";
import { addTrack, closeTestDatabase, openTestDatabase } from "../library/db/testDatabase.ts";

test("a continued album, artist and playlist read the same songs as their Library pages after a restart", async (t) => {
  const db = await openTestDatabase();
  t.after(() => closeTestDatabase(db));
  const first = addTrack(db, { title: "First", artist: "Artist", album: "Album" });
  addTrack(db, { title: "Last", artist: "Artist", album: "Album" });
  const albumId = selectAlbums(db, undefined)[0]!.id;
  const artistId = selectArtists(db, {})[0]!.id;
  const playlistId = createPlaylist(
    db,
    "Playlist",
    [{ source: "library", trackId: first }],
    1,
  ).playlistId;
  const store = {
    getAlbum: (id: number) => Effect.succeed(selectAlbumDetail(db, id)),
    getArtist: (id: number) => Effect.succeed(selectArtistDetail(db, id)),
    getPlaylist: (id: number) => Effect.succeed(selectPlaylist(db, id)),
    songsByIds: (ids: readonly number[]) =>
      Effect.succeed(
        selectPlayableSongs(db, ids).filter(
          (song): song is typeof song & { path: string } => song.path !== null,
        ),
      ),
  };
  for (const [kind, id, title, titles] of [
    ["album", albumId, "Album", ["First", "Last"]],
    ["artist", artistId, "Artist", ["First", "Last"]],
    ["playlist", playlistId, "Playlist", ["First"]],
  ] as const) {
    const input = await Effect.runPromise(
      readQueueContinuationSeed({ kind, id: String(id) }, store, new Map()),
    );
    assert.deepEqual(input?.seed, { kind, id: String(id), title });
    assert.deepEqual(
      input?.songs.map((song) => song.title),
      titles,
    );
  }
});

test("a loose queue reads every restored entry, including History, as a list seed", async (t) => {
  const db = await openTestDatabase();
  t.after(() => closeTestDatabase(db));
  const first = addTrack(db, { title: "History", artist: "Artist", album: "Album" });
  const last = addTrack(db, { title: "Last", artist: "Artist", album: "Album" });
  const historyId = String(first);
  const lastId = String(last);
  const store = {
    getAlbum: () => Effect.succeed(null),
    getArtist: () => Effect.succeed(null),
    getPlaylist: () => Effect.succeed(null),
    songsByIds: (ids: readonly number[]) =>
      Effect.succeed(
        selectPlayableSongs(db, ids).filter(
          (song): song is typeof song & { path: string } => song.path !== null,
        ),
      ),
  };
  let queue = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: [historyId, lastId],
    context: { kind: "songs", id: null },
  }).state;
  queue = reduceQueue(queue, { type: "next" }).state;
  const input = await Effect.runPromise(
    readQueueContinuationSeed(
      { kind: "list", id: lastId, trackIds: queue.entries.map((entry) => entry.trackId) },
      store,
      new Map(),
    ),
  );
  assert.deepEqual(input?.seed, { kind: "list", id: lastId, title: "Last" });
  assert.deepEqual(
    input?.songs.map((song) => song.title),
    ["History", "Last"],
  );
});

test("a saved Discover mix restores its song radios after restart, then falls back to the queue list when gone", async (t) => {
  const db = await openTestDatabase();
  t.after(() => closeTestDatabase(db));
  const history = addTrack(db, { title: "History", artist: "Artist", album: "Album" });
  const last = addTrack(db, { title: "Last", artist: "Artist", album: "Album" });
  const store = {
    getAlbum: () => Effect.succeed(null),
    getArtist: () => Effect.succeed(null),
    getPlaylist: () => Effect.succeed(null),
    songsByIds: (ids: readonly number[]) =>
      Effect.succeed(
        selectPlayableSongs(db, ids).filter(
          (song): song is typeof song & { path: string } => song.path !== null,
        ),
      ),
  };
  const queue = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: [String(history), String(last)],
    context: { kind: "discoverMix", id: "mix-42" },
  }).state;
  const source = {
    kind: "discoverMix",
    id: "mix-42",
    trackIds: queue.entries.map((entry) => entry.trackId),
  } as const;
  const mix = {
    id: "mix-42",
    seed: { kind: "artist", name: "Artist" },
    songs: [
      {
        videoId: "radio-song",
        title: "Radio song",
        artists: ["Radio Artist"],
        album: "Radio album",
        albumId: null,
        durationMs: 180000,
        artworkUrl: null,
        explicit: false,
      },
    ],
    familiar: [],
  } as DiscoverMix;

  const restored = await Effect.runPromise(
    readQueueContinuationSeed(source, store, new Map(), () => ({ mix, title: "Artist mix" })),
  );
  assert.deepEqual(restored?.seed, { kind: "list", id: "mix-42", title: "Artist mix" });
  assert.deepEqual(restored?.streamed.map((song) => song.videoId), ["radio-song"]);

  const fallback = await Effect.runPromise(readQueueContinuationSeed(source, store, new Map()));
  assert.deepEqual(fallback?.seed, { kind: "list", id: String(last), title: "Last" });
  assert.deepEqual(fallback?.songs.map((song) => song.title), ["History", "Last"]);
});
