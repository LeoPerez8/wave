import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NO_SEARCHES,
  SEARCH_ALLOWANCE,
  SEARCH_WINDOW_MS,
  readSearchAllowance,
  searchFailedLine,
  searchTurns,
  searchTurnWanted,
  searchTurnWithdrawn,
  searchWaitLine,
  writeSearchAllowance,
  type SearchAllowance,
} from "./index.ts";

/** The allowance with [count] searches asked at [at]. */
const spent = (count: number, at = 0): SearchAllowance => ({
  ...NO_SEARCHES,
  searchesAt: Array.from({ length: count }, () => at),
});

describe("the YouTube Music search allowance", () => {
  test("a download waiting is served before the import, whoever asked first", () => {
    // One search asked at 0, the other 999 a second later: one is free again at the window's end.
    const searchesAt = [0, ...spent(SEARCH_ALLOWANCE - 1, 1000).searchesAt];
    let allowance: SearchAllowance = { ...NO_SEARCHES, searchesAt };
    allowance = searchTurnWanted(allowance, { id: 1, asker: "import" }, 2000);
    allowance = searchTurnWanted(allowance, { id: 2, asker: "download" }, 3000);
    const full = searchTurns(allowance, 4000);
    assert.deepEqual(full.go, []);
    assert.equal(full.nextAt, SEARCH_WINDOW_MS);
    const one = searchTurns(full.allowance, SEARCH_WINDOW_MS);
    assert.deepEqual(one.go, [2], "the one search free goes to the download");
    assert.equal(one.nextAt, SEARCH_WINDOW_MS + 1000);
    assert.deepEqual(searchTurns(one.allowance, SEARCH_WINDOW_MS + 1000).go, [1]);
  });

  test("however many ask, the window never holds more than 1,000, and every search gets its turn", () => {
    let allowance = NO_SEARCHES;
    const asked: number[] = [];
    let id = 0;
    // An import asking 2,500, and a download every 3 seconds, for 40 minutes, a second apart.
    for (let now = 0; now < 40 * 60_000; now += 1000) {
      if (now < 2_500_000) {
        allowance = searchTurnWanted(allowance, { id: (id += 1), asker: "import" }, now);
        allowance = searchTurnWanted(allowance, { id: (id += 1), asker: "import" }, now);
      }
      if (now % 3000 === 0)
        allowance = searchTurnWanted(allowance, { id: (id += 1), asker: "download" }, now);
      const turns = searchTurns(allowance, now);
      allowance = turns.allowance;
      for (const _ of turns.go) asked.push(now);
    }
    for (const at of asked) {
      const inWindow = asked.filter((other) => other > at - SEARCH_WINDOW_MS && other <= at);
      assert.ok(inWindow.length <= SEARCH_ALLOWANCE, `${inWindow.length} searches by ${at}`);
    }
    assert.equal(asked.length + allowance.waiting.length, id);
  });

  test("Try Again has downloads' priority: before the import, and with downloads in the order they asked", () => {
    let allowance = spent(SEARCH_ALLOWANCE - 2);
    allowance = searchTurnWanted(allowance, { id: 1, asker: "import" }, 10);
    allowance = searchTurnWanted(allowance, { id: 2, asker: "tryAgain" }, 20);
    allowance = searchTurnWanted(allowance, { id: 3, asker: "download" }, 30);
    allowance = searchTurnWanted(allowance, { id: 4, asker: "tryAgain" }, 40);
    const turns = searchTurns(allowance, 50);
    assert.deepEqual(turns.go, [2, 3]);
    assert.deepEqual(
      turns.allowance.waiting.map(({ id }) => id),
      [1, 4],
    );
    assert.deepEqual(searchTurns(turns.allowance, SEARCH_WINDOW_MS).go, [4, 1]);
  });

  test("a download never waits behind the import while the window has room", () => {
    let allowance = spent(SEARCH_ALLOWANCE - 1);
    allowance = searchTurnWanted(allowance, { id: 1, asker: "import" }, 10);
    allowance = searchTurnWanted(allowance, { id: 2, asker: "import" }, 10);
    allowance = searchTurnWanted(allowance, { id: 3, asker: "download" }, 20);
    const turns = searchTurns(allowance, 30);
    assert.deepEqual(turns.go, [3]);
    assert.deepEqual(
      turns.allowance.waiting.map(({ id }) => id),
      [1, 2],
    );
  });

  test("a search given up while it waits leaves the line and spends nothing", () => {
    let allowance = spent(SEARCH_ALLOWANCE);
    allowance = searchTurnWanted(allowance, { id: 1, asker: "import" }, 10);
    allowance = searchTurnWanted(allowance, { id: 2, asker: "import" }, 10);
    allowance = searchTurnWithdrawn(allowance, 1);
    const turns = searchTurns(allowance, SEARCH_WINDOW_MS);
    assert.deepEqual(turns.go, [2]);
    assert.equal(turns.allowance.searchesAt.length, 1);
    assert.equal(turns.nextAt, null);
  });

  test("is kept while Wave is closed: the searches asked, not those waiting", () => {
    let allowance = searchTurnWanted(spent(SEARCH_ALLOWANCE - 1), { id: 1, asker: "import" }, 10);
    allowance = searchTurnWanted(allowance, { id: 2, asker: "import" }, 10);
    allowance = searchTurns(allowance, 10).allowance;
    const kept = readSearchAllowance(writeSearchAllowance(allowance));
    assert.equal(kept.searchesAt.length, SEARCH_ALLOWANCE);
    assert.deepEqual(kept.waiting, []);
    const after = searchTurnWanted(kept, { id: 1, asker: "download" }, 20);
    assert.deepEqual(searchTurns(after, 20).go, []);
  });

  test("reads the searches Spotify imports kept before every search shared it", () => {
    const kept = readSearchAllowance(JSON.stringify({ searchesAt: [30, 10, 20] }));
    assert.deepEqual(kept, { ...NO_SEARCHES, searchesAt: [10, 20, 30] });
    assert.deepEqual(readSearchAllowance(null), NO_SEARCHES);
    assert.deepEqual(readSearchAllowance("{"), NO_SEARCHES);
    assert.deepEqual(readSearchAllowance('{"searchesAt":"x"}'), NO_SEARCHES);
  });
});

describe("the app log of the search allowance", () => {
  /** 13:00:00 UTC on 2026-10-16. */
  const ONE_PM = Date.UTC(2026, 9, 16, 13);

  test("a wait writes a line when it starts and one when it ends: who, from when until when, and what the window held", () => {
    let allowance = spent(SEARCH_ALLOWANCE, ONE_PM - 60_000);
    const lines: string[] = [];
    const run = (now: number) => {
      const turns = searchTurns(allowance, now);
      allowance = turns.allowance;
      lines.push(...turns.waits.map(searchWaitLine));
      return turns;
    };
    // Four import searches and a download wait; asked again and again while they do, the lines aren't.
    for (let id = 1; id <= 4; id += 1)
      allowance = searchTurnWanted(allowance, { id, asker: "import" }, ONE_PM);
    run(ONE_PM);
    allowance = searchTurnWanted(allowance, { id: 5, asker: "download" }, ONE_PM + 1000);
    run(ONE_PM + 1000);
    run(ONE_PM + 2000);
    assert.deepEqual(lines, [
      "The import waits for the YouTube Music search allowance: 1,000 searches in the last 15 min, the most it allows; the next is free at 13:14:00 UTC",
      "A download waits for the YouTube Music search allowance: 1,000 searches in the last 15 min, the most it allows; the next is free at 13:14:00 UTC",
    ]);
    lines.length = 0;
    run(ONE_PM + 14 * 60_000);
    assert.deepEqual(lines, [
      "A download waited for the YouTube Music search allowance from 13:00:01 to 13:14:00 UTC (13 min 59 s, with 1,000 searches in the last 15 min)",
      "The import waited for the YouTube Music search allowance from 13:00:00 to 13:14:00 UTC (14 min, with 1,000 searches in the last 15 min)",
    ]);
  });

  test("a failed search says who asked, the search and how it failed", () => {
    assert.equal(
      searchFailedLine("download", "Within Daft Punk", "offline"),
      'A YouTube Music search for a download failed (offline): "Within Daft Punk"',
    );
    assert.equal(
      searchFailedLine("import", "Within Daft Punk", "disabled"),
      'A YouTube Music search for the import failed (YT Music off): "Within Daft Punk"',
    );
    assert.equal(
      searchFailedLine("discover", "Daft Punk", "failed"),
      'A YouTube Music search for a Discover mix failed (failed): "Daft Punk"',
    );
    assert.equal(
      searchFailedLine("tryAgain", "Within Daft Punk", "failed"),
      'A YouTube Music search for Try Again failed (failed): "Within Daft Punk"',
    );
  });

  test("Try Again's wait names it", () => {
    let allowance = spent(SEARCH_ALLOWANCE, ONE_PM - 60_000);
    allowance = searchTurnWanted(allowance, { id: 1, asker: "tryAgain" }, ONE_PM);
    assert.deepEqual(searchTurns(allowance, ONE_PM).waits.map(searchWaitLine), [
      "Try Again waits for the YouTube Music search allowance: 1,000 searches in the last 15 min, the most it allows; the next is free at 13:14:00 UTC",
    ]);
  });

  test("a search that goes at once writes nothing", () => {
    const allowance = searchTurnWanted(NO_SEARCHES, { id: 1, asker: "discover" }, 0);
    assert.deepEqual(searchTurns(allowance, 0).waits, []);
  });
});
