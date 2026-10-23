import assert from "node:assert/strict";
import { test } from "node:test";

import { slowReadLine, slowReadsLine } from "./index.ts";

test("a Library read logs only above its 16 ms JS budget", () => {
  const read = { operation: "list songs", rows: 12_431, route: "/(tabs)" };
  assert.equal(slowReadLine({ ...read, durationMs: 15 }), null);
  assert.equal(slowReadLine({ ...read, durationMs: 16 }), null);
  assert.equal(
    slowReadLine({ ...read, durationMs: 16.1 }),
    'Read "list songs" held JS 16 ms (12,431 rows) on /(tabs)',
  );
  assert.equal(
    slowReadLine({ ...read, durationMs: 640 }),
    'Read "list songs" held JS 640 ms (12,431 rows) on /(tabs)',
  );
});

test("slow reads use milliseconds below a second, then seconds with one decimal", () => {
  const read = { operation: "read Home's plays", rows: 1, route: "/home" };
  assert.equal(
    slowReadLine({ ...read, durationMs: 999 }),
    'Read "read Home\'s plays" held JS 999 ms (1 row) on /home',
  );
  assert.equal(
    slowReadLine({ ...read, rows: 0, durationMs: 1_000 }),
    'Read "read Home\'s plays" held JS 1.0 s (0 rows) on /home',
  );
  assert.equal(
    slowReadLine({ ...read, durationMs: 34_217 }),
    'Read "read Home\'s plays" held JS 34.2 s (1 row) on /home',
  );
});

test("consecutive slow reads share a single line and retain each route", () => {
  assert.equal(slowReadsLine([]), null);
  assert.equal(
    slowReadsLine([
      { operation: "list songs", rows: 12_431, route: "/home", durationMs: 640 },
      { operation: "list artists", rows: 2, route: "/artists", durationMs: 1_230 },
      { operation: "read favorites", rows: 0, route: "/artists", durationMs: 16 },
    ]),
    'Read "list songs" held JS 640 ms (12,431 rows) on /home; Read "list artists" held JS 1.2 s (2 rows) on /artists',
  );
  assert.equal(
    slowReadsLine([{ operation: "fast", rows: 0, route: "/home", durationMs: 1 }]),
    null,
  );
});
