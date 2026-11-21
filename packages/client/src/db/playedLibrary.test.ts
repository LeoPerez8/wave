/// <reference types="node" />
import { finishSteps } from "@wave/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { createFastAgainFixture } from "./fastAgainFixture.ts";
import { playedLibraryRows, playedLibraryRowsSteps } from "./playedLibrary.ts";

test("the resolver's Library read a page per step is the whole read, in its order", async () => {
  const { db } = await createFastAgainFixture(1000);
  const whole = playedLibraryRows(db);
  const steps = playedLibraryRowsSteps(db);
  let count = 0;
  while (steps.next().done !== true) count++;
  const paged = finishSteps(playedLibraryRowsSteps(db));
  assert.ok(count > 4, `${count} steps`);
  assert.deepEqual(
    paged.artists,
    whole.artists.map(({ id, name }) => ({ id, name })),
  );
  assert.deepEqual(
    paged.albums,
    whole.albums.map(({ id, title, albumArtistIds }) => ({ id, title, albumArtistIds })),
  );
  assert.deepEqual([...new Set(paged.credits)].sort(), [...new Set(whole.credits)].sort());
});
