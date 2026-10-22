import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { rankPopular, type YtSong } from "./index.ts";

/** A Library song with what matching compares: title, artist credit and length. */
const libra = (id: number, title: string, artist = "Bad Omens", durationMs = 200_000) => ({
  id,
  title,
  artist,
  durationMs,
});

/** A YT Music song with what matching compares. */
const yt = (videoId: string, title: string, artists = ["Bad Omens"], durationMs = 200_000) =>
  ({ videoId, title, artists, durationMs, album: null }) as unknown as YtSong;

const ranksOf = <S extends { readonly id: number }>(
  songs: readonly (S & { readonly popularRank: number | undefined })[],
) => songs.map((song) => [song.id, song.popularRank]);

describe("rankPopular", () => {
  test("ranks each Library song by its place in the artist's list, 1 first", () => {
    const songs = [libra(1, "Just Pretend"), libra(2, "Bad Decisions"), libra(3, "Ghost")];
    const popular = [yt("a", "Bad Decisions"), yt("b", "Ghost"), yt("c", "Just Pretend")];
    assert.deepEqual(ranksOf(rankPopular(songs, popular)), [
      [1, 3],
      [2, 1],
      [3, 2],
    ]);
  });

  test("a Library song the list doesn't hold has no rank", () => {
    const songs = [libra(1, "Unknown Demo"), libra(2, "Ghost")];
    const popular = [yt("b", "Ghost")];
    assert.deepEqual(ranksOf(rankPopular(songs, popular)), [
      [1, undefined],
      [2, 1],
    ]);
  });

  test("ranks skip where the list holds songs the Library lacks", () => {
    const songs = [libra(1, "Ghost"), libra(2, "Zero")];
    const popular = [yt("a", "Not Here"), yt("b", "Ghost"), yt("c", "Also Not"), yt("d", "Zero")];
    assert.deepEqual(ranksOf(rankPopular(songs, popular)), [
      [1, 2],
      [2, 4],
    ]);
  });

  test("matches as the Library's songs are matched to YouTube Music's: case, featured credits and remaster notes aside", () => {
    const songs = [libra(1, "Heathens (Remastered 2011)", "twenty one pilots")];
    const popular = [yt("a", "Heathens", ["Twenty One Pilots"], 200_000)];
    assert.deepEqual(ranksOf(rankPopular(songs, popular)), [[1, 1]]);
  });

  test("a live take of a song is a different song, so it isn't ranked by the studio one", () => {
    const songs = [libra(1, "Ghost", "Bad Omens", 200_000)];
    const popular = [yt("a", "Ghost", ["Bad Omens"], 320_000)];
    assert.deepEqual(ranksOf(rankPopular(songs, popular)), [[1, undefined]]);
  });

  test("a song the list names twice keeps its higher place", () => {
    const songs = [libra(1, "Ghost")];
    const popular = [yt("a", "Other"), yt("b", "Ghost"), yt("c", "Ghost")];
    assert.deepEqual(ranksOf(rankPopular(songs, popular)), [[1, 2]]);
  });

  test("with no list, nothing is ranked, and the songs are kept as given", () => {
    const songs = [libra(1, "Ghost"), libra(2, "Zero")];
    assert.deepEqual(ranksOf(rankPopular(songs, [])), [
      [1, undefined],
      [2, undefined],
    ]);
  });

  test("keeps every song's own fields", () => {
    const [ranked] = rankPopular([libra(7, "Ghost")], [yt("a", "Ghost")]);
    assert.equal(ranked?.title, "Ghost");
    assert.equal(ranked?.artist, "Bad Omens");
    assert.equal(ranked?.popularRank, 1);
  });
});
