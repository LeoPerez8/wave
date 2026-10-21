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
