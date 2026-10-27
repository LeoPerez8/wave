import assert from "node:assert/strict";
import { test } from "node:test";

import { syncTriggers } from "./syncTriggers.ts";
import { fakeClock } from "./testSyncClock.ts";

/** Triggers over a sync that records when it ran and succeeds unless told otherwise. */
const scheduled = () => {
  const { clock, pass } = fakeClock();
  const runs: { at: number; songs: boolean }[] = [];
  let fails = false;
  const triggers = syncTriggers({
    clock,
    run: async (songs) => {
      runs.push({ at: clock.now(), songs });
      return !fails;
    },
  });
  return {
    triggers,
    pass,
    runs,
    failing: (value: boolean) => {
      fails = value;
    },
  };
};

test("a play start schedules no sync", async () => {
  const { triggers, pass, runs } = scheduled();
  triggers.played("started");
  await pass(10 * 60_000);
  assert.deepEqual(runs, []);
});

test("play ends go up together a minute after the last one", async () => {
  const { triggers, pass, runs } = scheduled();
  triggers.played("ended");
  await pass(40_000);
  triggers.played("ended");
  await pass(59_000);
  assert.deepEqual(runs, []);
  await pass(1_000);
  assert.deepEqual(runs, [{ at: 100_000, songs: false }]);
  await pass(10 * 60_000);
  assert.equal(runs.length, 1);
});

test("play ends that never stop for a minute still go up within five minutes of the first", async () => {
  const { triggers, pass, runs } = scheduled();
  for (let i = 0; i < 20; i++) {
    triggers.played("ended");
    await pass(30_000);
  }
  // Ends every 30 s from 0 to 570 s: one batch caps at 300 s, the next at 600 s.
  assert.deepEqual(
    runs.map((run) => run.at),
    [300_000, 600_000],
  );
});

test("playlist, favorite and setting edits go up 3 seconds after the last one", async () => {
  const { triggers, pass, runs } = scheduled();
  triggers.edited({ songs: false });
  await pass(2_000);
  triggers.edited({ songs: false });
  await pass(2_999);
  assert.deepEqual(runs, []);
  await pass(1);
  assert.deepEqual(runs, [{ at: 5_000, songs: false }]);
});

test("an edit takes the play ends waiting with it, and a play end doesn't hold an edit back", async () => {
  const { triggers, pass, runs } = scheduled();
  triggers.played("ended");
  await pass(10_000);
  triggers.edited({ songs: false });
  await pass(3_000);
  assert.deepEqual(
    runs.map((run) => run.at),
    [13_000],
  );

  triggers.edited({ songs: false });
  await pass(1_000);
  triggers.played("ended");
  await pass(2_000);
  assert.deepEqual(
    runs.map((run) => run.at),
    [13_000, 16_000],
  );
  await pass(10 * 60_000);
  assert.equal(runs.length, 2);
});

test("a sync after a song list change looks at the songs, and again after a sync that didn't finish", async () => {
  const { triggers, pass, runs, failing } = scheduled();
  failing(true);
  triggers.edited({ songs: true });
  await pass(3_000);
  failing(false);
  triggers.edited({ songs: false });
  await pass(3_000);
  triggers.edited({ songs: false });
  await pass(3_000);
  assert.deepEqual(
    runs.map((run) => run.songs),
    [true, true, false],
  );
});

test("returning to the app syncs only once five minutes passed since the last sync that finished", async () => {
  const { triggers, pass, runs } = scheduled();
  triggers.now();
  await pass(1_000);
  triggers.foreground();
  await pass(4 * 60_000);
  triggers.foreground();
  await pass(59_000);
  assert.deepEqual(
    runs.map((run) => run.at),
    [0],
  );
  triggers.foreground();
  await pass(0);
  assert.deepEqual(
    runs.map((run) => run.at),
    [0, 300_000],
  );
});

test("returning to the app syncs at once after a sync that didn't finish", async () => {
  const { triggers, pass, runs, failing } = scheduled();
  failing(true);
  triggers.now();
  await pass(1_000);
  triggers.foreground();
  await pass(0);
  assert.deepEqual(
    runs.map((run) => run.at),
    [0, 1_000],
  );
});

test("returning to the app after the interval takes the play ends waiting with it", async () => {
  const { triggers, pass, runs } = scheduled();
  triggers.played("ended");
  await pass(10_000);
  triggers.foreground();
  await pass(10 * 60_000);
  assert.deepEqual(
    runs.map((run) => run.at),
    [10_000],
  );
});

test("returning to the app while a sync runs adds none; an edit meanwhile syncs once more after it", async () => {
  const { clock, pass } = fakeClock();
  const runs: number[] = [];
  let finish = (): void => {};
  const triggers = syncTriggers({
    clock,
    run: () =>
      new Promise((resolve) => {
        runs.push(clock.now());
        finish = () => resolve(false);
      }),
  });
  triggers.now();
  await pass(1_000);
  triggers.foreground();
  finish();
  await pass(0);
  assert.deepEqual(runs, [0]);

  triggers.edited({ songs: false });
  await pass(3_000);
  triggers.edited({ songs: false });
  await pass(3_000);
  assert.deepEqual(runs, [0, 4_000]);
  finish();
  await pass(0);
  assert.deepEqual(runs, [0, 4_000, 7_000]);
});

test("signing out drops the sync waiting", async () => {
  const { triggers, pass, runs } = scheduled();
  triggers.edited({ songs: false });
  triggers.played("ended");
  triggers.stop();
  await pass(10 * 60_000);
  assert.deepEqual(runs, []);
});

test("the first sync after launch looks at the song list when asked to", async () => {
  const { clock, pass } = fakeClock();
  const runs: boolean[] = [];
  const triggers = syncTriggers({
    clock,
    songsChanged: true,
    run: async (songs) => {
      runs.push(songs);
      return true;
    },
  });
  triggers.now();
  await pass(0);
  triggers.edited({ songs: false });
  await pass(3_000);
  assert.deepEqual(runs, [true, false]);
});
