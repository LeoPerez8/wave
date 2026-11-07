import assert from "node:assert/strict";
import { test } from "node:test";
import type { YtSong } from "@wave/core";
import { createNotificationStar } from "./notificationStar.ts";
import { playingSongTarget, type PlayingSongAnswer, type PlayingSongTarget } from "./songLookup.ts";

const song: YtSong = {
  videoId: "one",
  title: "One",
  artists: ["Artist"],
  album: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
};

const setup = (
  starred: (target: PlayingSongTarget, answer?: PlayingSongAnswer) => boolean | null,
) => {
  const shown: boolean[] = [];
  const settled: (PlayingSongTarget | null)[] = [];
  const starredTargets: PlayingSongTarget[] = [];
  const answers = new Map<string, PlayingSongAnswer>();
  const star = createNotificationStar({
    lookup: {
      update: (target, shownNow, ready) => {
        assert.equal(shownNow && ready, true);
        settled.push(target);
      },
      get: (target) => (target === null ? undefined : answers.get(target.trackId)),
    },
    starred,
    show: (on) => shown.push(on),
    star: async (target) => {
      starredTargets.push(target);
    },
  });
  return { star, shown, settled, starredTargets, answers };
};

test("the playing song's target: a YT Music song not known yet has none", () => {
  assert.deepEqual(playingSongTarget("7", null), { trackId: "7", song: null });
  assert.deepEqual(playingSongTarget("yt:one", song), { trackId: "yt:one", song });
  assert.equal(playingSongTarget("yt:one", null), null);
  assert.equal(playingSongTarget(null, null), null);
});

test("a Library song shows its star without reading the song", () => {
  const { star, shown, settled } = setup((target) => target.trackId === "7");
  star.follow({ trackId: "7", song: null });
  assert.deepEqual(shown, [true]);
  assert.deepEqual(settled, [null]);
});

test("a YT Music song is read, and its star shows once the answer is in", () => {
  const { star, shown, settled, answers } = setup((_, answer) => answer?.favorite === true);
  const target = { trackId: "yt:one", song };
  star.follow(target);
  assert.deepEqual(settled, [target]);
  assert.deepEqual(shown, [false]);
  answers.set("yt:one", { track: null, favorite: true, pendingFavorite: false });
  star.refresh();
  assert.deepEqual(shown, [false, true]);
});

test("the star only goes out when it changes, and following the same song changes nothing", () => {
  let on = false;
  const { star, shown, settled } = setup(() => on);
  star.follow({ trackId: "7", song: null });
  star.follow({ trackId: "7", song: null });
  star.follow({ trackId: "yt:one", song });
  star.follow({ trackId: "yt:one", song: { ...song } });
  star.refresh();
  on = true;
  star.refresh();
  star.refresh();
  assert.deepEqual(shown, [false, true]);
  assert.equal(settled.length, 2);
});

test("a tap stars the song showing; with no song, the outlined star ignores it", async () => {
  const { star, shown, starredTargets } = setup(() => true);
  await star.tap();
  assert.deepEqual(starredTargets, []);
  star.follow(null);
  assert.deepEqual(shown, [false]);
  const target = { trackId: "yt:one", song };
  star.follow(target);
  await star.tap();
  assert.deepEqual(starredTargets, [target]);
});

test("while the song's star isn't known yet, it shows an outline and a tap does nothing", async () => {
  let known = false;
  const { star, shown, starredTargets } = setup(() => (known ? true : null));
  const target = { trackId: "7", song: null };
  star.follow(target);
  await star.tap();
  assert.deepEqual(shown, [false]);
  assert.deepEqual(starredTargets, []);
  known = true;
  star.refresh();
  await star.tap();
  assert.deepEqual(shown, [false, true]);
  assert.deepEqual(starredTargets, [target]);
});
