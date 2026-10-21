import { eq } from "drizzle-orm";
import * as schema from "./schema.ts";
import { setFavorites } from "./playHistory.ts";
import { addPendingFavorites } from "./pendingFavorites.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { playlistRecommendations } from "@wave/core";
import { addTrack, openTestDatabase } from "./testDatabase.ts";
import { createPlaylist } from "./playlists.ts";
import { addCandidates } from "./candidateCatalog.ts";
import { selectPlaylistRecommendationInput } from "./playlistRecommendations.ts";

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
