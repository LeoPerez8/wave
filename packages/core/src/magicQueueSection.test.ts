import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  magicArtistKey,
  magicQueuePicks,
  magicQueuePicksDue,
  parseMagicQueuePicks,
  refreshedMagicQueuePicks,
  storedMagicQueuePicks,
  undoneMagicQueueRefresh,
  tasteProfile,
  type MagicSong,
  type RandomSource,
} from "./index.ts";

const song = (trackId: string, artist = `Artist ${trackId}`, genre = "Pop"): MagicSong => ({
  trackId,
  artists: [magicArtistKey(artist)],
  genre,
});

/** [count] Library songs, ids `s1`, `s2`… each by its own artist. */
const library = (count: number): MagicSong[] =>
  Array.from({ length: count }, (_, i) => song(`s${i + 1}`));

/** A random source that repeats from [seed]: the same draws every run. */
const seeded = (seed: number): RandomSource => {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};

const DAY = 24 * 60 * 60 * 1000;
/** Noon on a day, local time: a few hours either way stay on that day. */
const NOON = new Date(2026, 9, 19, 12).getTime();

describe("Home's Magic Queue section", () => {
  test("shows nine of the Library's songs, each once", () => {
    const songs = library(30);
    const picks = magicQueuePicks(null, songs, { now: NOON, taste: null, random: seeded(1) });
    assert.equal(picks.trackIds.length, 9);
    assert.equal(new Set(picks.trackIds).size, 9);
    const ids = new Set(songs.map((candidate) => candidate.trackId));
    assert.ok(picks.trackIds.every((id) => ids.has(id)));
  });

  test("shows the whole Library when it has fewer than nine songs", () => {
    const picks = magicQueuePicks(null, library(4), { now: NOON, taste: null, random: seeded(1) });
    assert.deepEqual([...picks.trackIds].sort(), ["s1", "s2", "s3", "s4"]);
  });

  test("leans on the taste profile: favorites and songs played through likelier, skipped songs less", () => {
    const songs = library(40);
    const at = NOON - DAY;
    const taste = tasteProfile(
      {
        plays: [
          ...Array.from({ length: 4 }, () => ({
            trackId: "s2",
            startedAt: at,
            listenedMs: 200_000,
            endReason: "completed" as const,
          })),
          ...Array.from({ length: 4 }, () => ({
            trackId: "s3",
            startedAt: at,
            listenedMs: 5_000,
            endReason: "skipped" as const,
          })),
        ],
        favorites: [{ trackId: "s1", changedAt: at }],
        downloads: [],
      },
      (trackId) => songs.find((candidate) => candidate.trackId === trackId),
      NOON,
    );
    const shown = { s1: 0, s2: 0, s3: 0, s4: 0 };
    const random = seeded(7);
    for (let day = 0; day < 400; day++) {
      const { trackIds } = magicQueuePicks(null, songs, { now: NOON, taste, random });
      for (const id of trackIds) if (id in shown) shown[id as keyof typeof shown] += 1;
    }
    // Unweighted, each song shows on 9 of every 40 days.
    assert.ok(shown.s1 > shown.s4 * 1.5, JSON.stringify(shown));
    assert.ok(shown.s2 > shown.s4 * 1.5, JSON.stringify(shown));
    assert.ok(shown.s3 < shown.s4 / 1.5, JSON.stringify(shown));
  });

  test("keeps its list all day, the same object when nothing changed", () => {
    const songs = library(30);
    const morning = magicQueuePicks(null, songs, {
      now: NOON - 3 * 3600_000,
      taste: null,
      random: seeded(1),
    });
    const evening = magicQueuePicks(morning, songs, {
      now: NOON + 8 * 3600_000,
      taste: null,
      random: seeded(2),
    });
    assert.equal(evening, morning);
  });

  test("brings a new list the next day", () => {
    const songs = library(30);
    const today = magicQueuePicks(null, songs, { now: NOON, taste: null, random: seeded(1) });
    const tomorrow = magicQueuePicks(today, songs, {
      now: NOON + DAY,
      taste: null,
      random: seeded(2),
    });
    assert.notEqual(tomorrow.day, today.day);
    assert.equal(tomorrow.trackIds.length, 9);
    assert.notDeepEqual(tomorrow.trackIds, today.trackIds);
    assert.deepEqual(tomorrow.shownToday, tomorrow.trackIds);
  });

  test("replaces a song gone from the Library, keeping the others in their places", () => {
    const songs = library(30);
    const today = magicQueuePicks(null, songs, { now: NOON, taste: null, random: seeded(1) });
    const gone = today.trackIds[3]!;
    const left = songs.filter((candidate) => candidate.trackId !== gone);
    const later = magicQueuePicks(today, left, {
      now: NOON + 3600_000,
      taste: null,
      random: seeded(2),
    });
    assert.equal(later.trackIds.length, 9);
    assert.ok(!later.trackIds.includes(gone));
    assert.deepEqual(
      later.trackIds.filter((_, place) => place !== 3),
      today.trackIds.filter((_, place) => place !== 3),
    );
    assert.ok(!today.trackIds.includes(later.trackIds[3]!));
  });

  test("shows nothing with nothing in the Library", () => {
    assert.deepEqual(
      magicQueuePicks(null, [], { now: NOON, taste: null, random: seeded(1) }).trackIds,
      [],
    );
  });

  test("a pull brings another list, avoiding every song it showed today", () => {
    const songs = library(30);
    const today = magicQueuePicks(null, songs, { now: NOON, taste: null, random: seeded(1) });
    const pulled = refreshedMagicQueuePicks(today, songs, {
      now: NOON,
      taste: null,
      random: seeded(2),
    });
    assert.equal(pulled.trackIds.length, 9);
    assert.ok(pulled.trackIds.every((id) => !today.trackIds.includes(id)));
    const again = refreshedMagicQueuePicks(pulled, songs, {
      now: NOON,
      taste: null,
      random: seeded(3),
    });
    assert.ok(
      again.trackIds.every((id) => !today.trackIds.includes(id) && !pulled.trackIds.includes(id)),
    );
    assert.equal(new Set(again.shownToday).size, 27);
  });

  test("once every song was shown today, a pull brings back songs from earlier lists", () => {
    const songs = library(15);
    const today = magicQueuePicks(null, songs, { now: NOON, taste: null, random: seeded(1) });
    const pulled = refreshedMagicQueuePicks(today, songs, {
      now: NOON,
      taste: null,
      random: seeded(2),
    });
    assert.equal(pulled.trackIds.length, 9);
    assert.equal(new Set(pulled.trackIds).size, 9);
    const fresh = pulled.trackIds.filter((id) => !today.trackIds.includes(id));
    assert.equal(fresh.length, 6);
    // The fresh songs first.
    assert.deepEqual(pulled.trackIds.slice(0, 6), fresh);
  });

  test("a pull on a new day avoids only that day's songs", () => {
    const songs = library(20);
    const yesterday = magicQueuePicks(null, songs, {
      now: NOON - DAY,
      taste: null,
      random: seeded(1),
    });
    const pulled = refreshedMagicQueuePicks(yesterday, songs, {
      now: NOON,
      taste: null,
      random: seeded(2),
    });
    assert.notEqual(pulled.day, yesterday.day);
    assert.deepEqual(pulled.shownToday, pulled.trackIds);
  });

  test("Undo after a pull puts the list before it back, still avoiding both on the next pull", () => {
    const songs = library(30);
    const today = magicQueuePicks(null, songs, { now: NOON, taste: null, random: seeded(1) });
    const pulled = refreshedMagicQueuePicks(today, songs, {
      now: NOON,
      taste: null,
      random: seeded(2),
    });
    const undone = undoneMagicQueueRefresh(today, pulled);
    assert.deepEqual(undone.trackIds, today.trackIds);
    const next = refreshedMagicQueuePicks(undone, songs, {
      now: NOON,
      taste: null,
      random: seeded(3),
    });
    assert.ok(
      next.trackIds.every((id) => !today.trackIds.includes(id) && !pulled.trackIds.includes(id)),
    );
  });

  test("what it shows reads back as it was stored", () => {
    const today = magicQueuePicks(null, library(30), { now: NOON, taste: null, random: seeded(1) });
    assert.deepEqual(parseMagicQueuePicks(storedMagicQueuePicks(today)), today);
  });

  test("nothing stored, or anything unreadable, reads as nothing shown yet", () => {
    for (const stored of [
      null,
      "",
      "junk",
      "[]",
      "{}",
      '{"day":3,"trackIds":[],"shownToday":[]}',
      '{"day":"d","trackIds":[1],"shownToday":[]}',
    ])
      assert.equal(parseMagicQueuePicks(stored), null, String(stored));
  });

  test("tells when what it shows needs picking: nothing yet, a new day, a song gone, room for more", () => {
    const songs = library(30);
    const today = magicQueuePicks(null, songs, { now: NOON, taste: null, random: seeded(1) });
    assert.equal(magicQueuePicksDue(null, songs, NOON), true);
    assert.equal(magicQueuePicksDue(today, songs, NOON + 3600_000), false);
    assert.equal(magicQueuePicksDue(today, songs, NOON + DAY), true);
    const gone = songs.filter((candidate) => candidate.trackId !== today.trackIds[0]);
    assert.equal(magicQueuePicksDue(today, gone, NOON), true);
    const few = magicQueuePicks(null, library(4), { now: NOON, taste: null, random: seeded(1) });
    assert.equal(magicQueuePicksDue(few, library(4), NOON), false);
    assert.equal(magicQueuePicksDue(few, library(6), NOON), true);
  });
});

test("a saved ten-song section adapts immediately to nine while retaining its first nine seeds", () => {
  const saved = {
    day: "",
    trackIds: library(10).map((s) => s.trackId),
    shownToday: library(10).map((s) => s.trackId),
  };
  // Use the public picker for the persisted local day format.
  saved.day = magicQueuePicks(null, library(30), { now: NOON, taste: null, random: seeded(1) }).day;
  assert.equal(magicQueuePicksDue(saved, library(30), NOON), true);
  assert.deepEqual(
    magicQueuePicks(saved, library(30), { now: NOON, taste: null, random: seeded(1) }).trackIds,
    ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"],
  );
});
