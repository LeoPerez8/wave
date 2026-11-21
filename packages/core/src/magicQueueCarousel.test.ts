import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  carouselPageSongs,
  catalogueOf,
  isRecent,
  magicQueueCarouselPage,
  magicQueueCarouselKeptPage,
  magicQueueCarouselPageLabel,
  magicQueueCarouselPageTitle,
  magicQueueCarouselPages,
  magicQueueCarouselRestarts,
  mostListenedRecently,
  inYourOrbitSongs,
  recentPlaysWindow,
  type SongPlayTotals,
  type TrackRef,
} from "./index.ts";

const en = catalogueOf("en");
const ptBR = catalogueOf("pt-BR");
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);

const library = (id: number): TrackRef => ({ kind: "library", id });
const streamed = (videoId: string): TrackRef => ({ kind: "yt", videoId });

const plays = (song: TrackRef, countedPlays: number, latestPlayAt = NOW): SongPlayTotals => ({
  song,
  countedPlays,
  listenedMs: countedPlays * 200_000,
  latestPlayAt,
  sortKey: song.kind === "library" ? `song ${song.id}` : song.videoId,
});

describe("recentPlaysWindow", () => {
  test("covers the plays of the last 14 days, the one started exactly 14 days ago included", () => {
    const window = recentPlaysWindow(NOW);
    assert.deepEqual(window, { from: NOW - 14 * DAY, to: NOW });
    const inside = (at: number) => window.from !== null && at >= window.from && at <= window.to;
    for (const at of [NOW, NOW - DAY, NOW - 14 * DAY, NOW - 14 * DAY - 1, NOW + 1])
      assert.equal(inside(at), isRecent(at, NOW), `a play ${NOW - at} ms ago`);
    assert.equal(inside(NOW - 14 * DAY), true);
    assert.equal(inside(NOW - 14 * DAY - 1), false);
  });
});

describe("mostListenedRecently", () => {
  test("ranks songs by their counted plays in the window, the most played first", () => {
    assert.deepEqual(mostListenedRecently([plays(library(1), 2), plays(library(2), 7)]), [
      library(2),
      library(1),
    ]);
  });

  test("ranks streamed songs among the Library's", () => {
    assert.deepEqual(
      mostListenedRecently([
        plays(library(1), 2),
        plays(streamed("often"), 9),
        plays(streamed("once"), 1),
        plays(library(2), 4),
      ]),
      [streamed("often"), library(2), library(1), streamed("once")],
    );
  });

  test("leaves out a song without a counted play", () => {
    assert.deepEqual(mostListenedRecently([plays(library(1), 0), plays(streamed("a"), 1)]), [
      streamed("a"),
    ]);
  });

  test("breaks a tie by the latest play", () => {
    assert.deepEqual(
      mostListenedRecently([plays(library(1), 3, NOW - DAY), plays(library(2), 3, NOW)]),
      [library(2), library(1)],
    );
  });

  test("breaks tied play counts by time listened before the latest play", () => {
    const longer = { ...plays(library(1), 3, NOW - DAY), listenedMs: 600_000 };
    const newer = { ...plays(library(2), 3, NOW), listenedMs: 300_000 };
    assert.deepEqual(mostListenedRecently([newer, longer]), [library(1), library(2)]);
  });
});

describe("inYourOrbitSongs", () => {
  test("shows the nine most listened songs when at least nine have counted plays", () => {
    const totals = Array.from({ length: 10 }, (_, index) => plays(library(index + 1), index + 1));
    assert.deepEqual(inYourOrbitSongs(totals), [
      library(10),
      library(9),
      library(8),
      library(7),
      library(6),
      library(5),
      library(4),
      library(3),
      library(2),
    ]);
  });

  test("leaves the section out when fewer than nine songs have counted plays", () => {
    const totals = Array.from({ length: 8 }, (_, index) => plays(library(index + 1), index + 1));
    assert.deepEqual(inYourOrbitSongs(totals), []);
  });
});

describe("carouselPageSongs", () => {
  const songs = Array.from({ length: 12 }, (_, place) => `song ${place}`);

  test("keeps the first nine songs", () => {
    assert.deepEqual(carouselPageSongs(songs), songs.slice(0, 9));
  });

  test("keeps a page of three songs", () => {
    assert.deepEqual(carouselPageSongs(songs.slice(0, 3)), songs.slice(0, 3));
  });

  test("gives no song when there are fewer than three", () => {
    assert.deepEqual(carouselPageSongs(songs.slice(0, 2)), []);
    assert.deepEqual(carouselPageSongs([]), []);
  });
});

describe("magicQueueCarouselPages", () => {
  test("puts Most listened recently before the Magic Queue page", () => {
    assert.deepEqual(
      magicQueueCarouselPages({ "most-listened-recently": 9, "magic-queue": 9, discoveries: 0 }),
      ["most-listened-recently", "magic-queue"],
    );
  });

  test("shows the Magic Queue page alone when too few songs were played recently", () => {
    assert.deepEqual(
      magicQueueCarouselPages({ "most-listened-recently": 2, "magic-queue": 9, discoveries: 0 }),
      ["magic-queue"],
    );
  });

  test("keeps the Magic Queue page of a small Library", () => {
    assert.deepEqual(
      magicQueueCarouselPages({ "most-listened-recently": 0, "magic-queue": 1, discoveries: 0 }),
      ["magic-queue"],
    );
  });

  test("leaves out a Magic Queue page with nothing to show", () => {
    assert.deepEqual(
      magicQueueCarouselPages({ "most-listened-recently": 4, "magic-queue": 0, discoveries: 0 }),
      ["most-listened-recently"],
    );
    assert.deepEqual(
      magicQueueCarouselPages({ "most-listened-recently": 0, "magic-queue": 0, discoveries: 0 }),
      [],
    );
  });
});

describe("magicQueueCarouselPage", () => {
  const pages = ["most-listened-recently", "magic-queue"] as const;

  test("opens on the first page", () => {
    assert.equal(magicQueueCarouselPage(pages, null), 0);
  });

  test("keeps the page that was showing", () => {
    assert.equal(magicQueueCarouselPage(pages, "magic-queue"), 1);
  });

  test("falls back to the first page when the kept one is left out", () => {
    assert.equal(magicQueueCarouselPage(["magic-queue"], "most-listened-recently"), 0);
  });
});

describe("magicQueueCarouselKeptPage", () => {
  test("remembers the first page drawn when none is kept", () => {
    assert.equal(magicQueueCarouselKeptPage(["magic-queue", "discoveries"], null), "magic-queue");
    assert.equal(magicQueueCarouselKeptPage([], null), null);
  });

  test("a page joining before the one in sight leaves that page in sight", () => {
    const first = magicQueueCarouselKeptPage(["magic-queue"], null);
    const joined = ["most-listened-recently", "magic-queue"] as const;
    assert.equal(magicQueueCarouselPage(joined, magicQueueCarouselKeptPage(joined, first)), 1);
  });

  test("keeps a page that is missing, so the row returns to it", () => {
    assert.equal(magicQueueCarouselKeptPage(["magic-queue"], "discoveries"), "discoveries");
  });
});

describe("magicQueueCarouselRestarts", () => {
  const row = (pages: readonly string[], index: number, width = 400) => ({ width, pages, index });

  test("a swipe to another page leaves the row as it is", () => {
    const pages = ["recent", "queue", "discoveries"];
    assert.equal(magicQueueCarouselRestarts(row(pages, 0), row(pages, 1)), false);
    assert.equal(magicQueueCarouselRestarts(row(pages, 2), row(pages, 1)), false);
  });

  test("a page joining or leaving after the one in sight leaves the row as it is", () => {
    const before = row(["recent", "queue"], 1);
    assert.equal(
      magicQueueCarouselRestarts(before, row(["recent", "queue", "discoveries"], 1)),
      false,
    );
    assert.equal(
      magicQueueCarouselRestarts(row(["recent", "queue", "discoveries"], 1), before),
      false,
    );
  });

  test("a page joining or leaving before the one in sight starts the row over", () => {
    assert.equal(magicQueueCarouselRestarts(row(["queue"], 0), row(["recent", "queue"], 1)), true);
    assert.equal(magicQueueCarouselRestarts(row(["recent", "queue"], 1), row(["queue"], 0)), true);
    assert.equal(
      magicQueueCarouselRestarts(row(["recent", "queue"], 1), row(["other", "queue"], 1)),
      true,
    );
  });

  test("a change of width starts the row over", () => {
    const pages = ["recent", "queue"];
    assert.equal(magicQueueCarouselRestarts(row(pages, 1), row(pages, 1, 401)), true);
  });

  test("the same row doesn't start over", () => {
    const pages = ["recent", "queue"];
    assert.equal(magicQueueCarouselRestarts(row(pages, 1), row([...pages], 1)), false);
  });
});

describe("the carousel's page names", () => {
  test("are in English and Brazilian Portuguese", () => {
    assert.equal(magicQueueCarouselPageTitle("most-listened-recently"), "Most listened recently");
    assert.equal(
      magicQueueCarouselPageTitle("most-listened-recently", ptBR),
      "Mais ouvidas recentemente",
    );
    assert.equal(magicQueueCarouselPageTitle("magic-queue", en), "Magic Queue");
    assert.equal(magicQueueCarouselPageTitle("magic-queue", ptBR), "Fila Mágica");
  });

  test("say where the page sits for a screen reader", () => {
    const pages = ["most-listened-recently", "magic-queue"] as const;
    assert.equal(magicQueueCarouselPageLabel(pages, 0, en), "Most listened recently, page 1 of 2");
    assert.equal(magicQueueCarouselPageLabel(pages, 1, ptBR), "Fila Mágica, página 2 de 2");
  });
});
