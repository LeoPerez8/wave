import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  magicArtistKey,
  tasteLearned,
  tasteProfile,
  type MagicSong,
  type TasteHistory,
} from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;

const song = (trackId: string, artist: string, genre: string | null = "rock"): MagicSong => ({
  trackId,
  artists: [magicArtistKey(artist)],
  genre,
});

const NONE: TasteHistory = { plays: [], favorites: [], downloads: [] };

const played = (trackId: string, at: number) =>
  ({ trackId, startedAt: at, listenedMs: 200_000, endReason: "completed" }) as const;
const skipped = (trackId: string, at: number, listenedMs = 5_000) =>
  ({ trackId, startedAt: at, listenedMs, endReason: "skipped" }) as const;

describe("A taste profile", () => {
  const songs = new Map(
    ["fav", "down", "full", "skip", "late", "none"].map((id) => [id, song(id, `Artist ${id}`)]),
  );
  const songOf = (trackId: string) => songs.get(trackId);

  test("weighs a favorite above a download above a song played to the end, a quick skip as negative", () => {
    const profile = tasteProfile(
      {
        plays: [played("full", NOW), skipped("skip", NOW), skipped("late", NOW, 45_000)],
        favorites: [{ trackId: "fav", changedAt: NOW }],
        downloads: [{ trackId: "down", downloadedAt: NOW }],
      },
      songOf,
      NOW,
    );
    const score = (id: string) => profile.songs.get(id) ?? 0;
    assert.ok(score("fav") > score("down"));
    assert.ok(score("down") > score("full"));
    assert.ok(score("full") > 0);
    assert.ok(score("skip") < 0);
    // Skipped after the first 30 s, or never played: nothing either way.
    assert.equal(score("late"), 0);
    assert.equal(score("none"), 0);
    assert.equal(tasteProfile(NONE, songOf, NOW).songs.size, 0);
  });

  test("halves a signal's weight every 30 days from when it happened", () => {
    const scoreOf = (history: Partial<TasteHistory>, id: string) =>
      tasteProfile({ ...NONE, ...history }, songOf, NOW).songs.get(id) ?? 0;
    const fresh = scoreOf({ favorites: [{ trackId: "fav", changedAt: NOW }] }, "fav");
    assert.equal(
      scoreOf({ favorites: [{ trackId: "fav", changedAt: NOW - 30 * DAY }] }, "fav"),
      fresh / 2,
    );
    assert.equal(
      scoreOf({ favorites: [{ trackId: "fav", changedAt: NOW - 60 * DAY }] }, "fav"),
      fresh / 4,
    );
    const freshPlay = scoreOf({ plays: [played("full", NOW)] }, "full");
    assert.equal(scoreOf({ plays: [played("full", NOW - 30 * DAY)] }, "full"), freshPlay / 2);
    const freshDownload = scoreOf({ downloads: [{ trackId: "down", downloadedAt: NOW }] }, "down");
    assert.equal(
      scoreOf({ downloads: [{ trackId: "down", downloadedAt: NOW - 30 * DAY }] }, "down"),
      freshDownload / 2,
    );
    // Signals add up: two plays a month apart weigh one and a half fresh ones.
    assert.equal(
      scoreOf({ plays: [played("full", NOW), played("full", NOW - 30 * DAY)] }, "full"),
      freshPlay * 1.5,
    );
  });

  test("adds up its songs' scores for each of their artists and their genre family", () => {
    const byGenre = new Map<string, MagicSong>([
      ["a1", song("a1", "Daft Punk", "Electronic")],
      ["a2", song("a2", "Daft Punk", "electronic")],
      [
        "duet",
        {
          trackId: "duet",
          artists: [magicArtistKey("Daft Punk"), magicArtistKey("Pharrell")],
          genre: "Pop",
        },
      ],
      ["untagged", song("untagged", "Pharrell", null)],
    ]);
    const profile = tasteProfile(
      {
        plays: [played("a1", NOW), played("duet", NOW), skipped("untagged", NOW)],
        favorites: [{ trackId: "a2", changedAt: NOW }],
        downloads: [],
      },
      (id) => byGenre.get(id),
      NOW,
    );
    const songScore = (id: string) => profile.songs.get(id) ?? 0;
    assert.equal(
      profile.artists.get(magicArtistKey("Daft Punk")),
      songScore("a1") + songScore("a2") + songScore("duet"),
    );
    assert.equal(
      profile.artists.get(magicArtistKey("Pharrell")),
      songScore("duet") + songScore("untagged"),
    );
    // Genre families compare without case.
    assert.equal(profile.genres.get("electronic"), songScore("a1") + songScore("a2"));
    assert.equal(profile.genres.get("pop"), songScore("duet"));
    assert.equal(profile.genres.size, 2);
  });

  test("learns a signal as it comes as if it were in the history", () => {
    const history: TasteHistory = { ...NONE, plays: [played("full", NOW - 10 * DAY)] };
    const before = tasteProfile(history, songOf, NOW - 5 * DAY);
    const fav = songs.get("fav");
    assert.ok(fav !== undefined);
    const learned = tasteLearned(before, { kind: "favorite", song: fav, at: NOW - 5 * DAY });
    const derived = tasteProfile(
      { ...history, favorites: [{ trackId: "fav", changedAt: NOW - 5 * DAY }] },
      songOf,
      NOW - 5 * DAY,
    );
    assert.deepEqual(learned, derived);
    // The profile it learned from stays as it was.
    assert.equal(before.songs.get("fav"), undefined);
  });
});
