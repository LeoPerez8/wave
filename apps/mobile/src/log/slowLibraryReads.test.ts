import assert from "node:assert/strict";
import { test } from "node:test";

import { connectLibraryReadLog, timeLibraryRead } from "./slowLibraryReads.ts";

test("the store's timing boundary runs without loading native logging and connects to the app log", (t) => {
  let at = 0;
  t.mock.method(performance, "now", () => at);
  const lines: string[] = [];
  const flush = connectLibraryReadLog({
    route: () => "/artists/7",
    write: (line) => lines.push(line),
  });
  const songs = [{ id: 1 }, { id: 2 }];
  assert.equal(
    timeLibraryRead("list the artist's songs", () => {
      at += 25;
      return songs;
    }),
    songs,
  );
  assert.deepEqual(lines, []);
  flush();
  assert.deepEqual(lines, ['Read "list the artist\'s songs" held JS 25 ms (2 rows) on /artists/7']);
});
