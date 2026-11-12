import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
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
