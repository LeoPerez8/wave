import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNowPlayingSongLookup,
  type PlayingSongAnswer,
  type PlayingSongTarget,
} from "./songLookup.ts";
import { createNowPlayingSongActions } from "./songActions.ts";
import type { SongRow } from "../library/LibraryStore.ts";

const target: PlayingSongTarget = {
  trackId: "yt:one",
  song: {
    videoId: "one",
    title: "One",
    artists: ["Artist"],
    album: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  },
};
const missing = { id: 7, path: null } as SongRow;

test("early actions share the captured song: a missing entry downloads into its Library id and toggles its actual star", async () => {
  let finish!: (answer: PlayingSongAnswer) => void;
  let reads = 0;
  const lookup = createNowPlayingSongLookup({
    read: () => {
      reads++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const downloads: unknown[] = [];
  const stars: unknown[] = [];
  const actions = createNowPlayingSongActions(lookup, {
    download: (command) => {
      downloads.push(command);
    },
    star: (captured, answer, on) => {
      stars.push([captured.trackId, answer.track?.id, on]);
    },
    starred: (_target, answer) => answer.favorite || answer.pendingFavorite,
  });
  lookup.update(target, true, false);
  const playlist = actions.playlist(target);
  const download = actions.download(target);
  const star = actions.star(target);
  await Promise.resolve();
  lookup.update(
    { ...target, trackId: "yt:next", song: { ...target.song!, videoId: "next" } },
    true,
    false,
  );
  finish({ track: missing, favorite: true, pendingFavorite: false });
  assert.deepEqual(await playlist, [{ source: "library", trackId: 7 }]);
  await Promise.all([download, star]);
  assert.equal(reads, 1);
  assert.deepEqual(downloads, [{ kind: "missing", id: 7 }]);
  assert.deepEqual(stars, [["yt:one", 7, false]]);
});
