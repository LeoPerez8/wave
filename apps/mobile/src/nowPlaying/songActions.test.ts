import assert from "node:assert/strict";
import { test } from "node:test";
import { createNowPlayingSongLookup } from "./songLookup.ts";
import { type PlayingSongAnswer, type PlayingSongTarget } from "@wave/client";
import { createNowPlayingSongActions } from "./songActions.ts";
import type { SongRow } from "@wave/client";

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
    dislike: async () => {},
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

test("rapid early toggles stay ordered and a separate artwork double tap only adds a star", async () => {
  const lookup = createNowPlayingSongLookup({
    read: async () => ({ track: null, favorite: false, pendingFavorite: true }),
  });
  lookup.update(target, true, false);
  let starred = true;
  const shown: boolean[] = [];
  const actions = createNowPlayingSongActions(lookup, {
    download: () => {},
    starred: () => starred,
    star: (_target, _answer, on) => {
      starred = on;
      shown.push(on);
    },
    dislike: async () => {},
  });
  await Promise.all([actions.star(target), actions.star(target), actions.star(target, true)]);
  assert.deepEqual(shown, [false, true, true]);
});

test("a downloaded song asks to be deleted, and an absent streamed one downloads", async () => {
  const file = { ...missing, path: "/Music/one.m4a" };
  const lookup = createNowPlayingSongLookup({
    read: async (captured) => ({
      track: captured.trackId === target.trackId ? file : null,
      favorite: false,
      pendingFavorite: false,
    }),
  });
  const downloads: unknown[] = [];
  const actions = createNowPlayingSongActions(lookup, {
    download: (command) => {
      downloads.push(command);
    },
    starred: () => false,
    star: () => {},
    dislike: async () => {},
  });
  lookup.update(target, true, false);
  await actions.download(target);
  const absent = {
    trackId: "yt:absent",
    song: { ...target.song!, videoId: "absent", title: "Absent" },
  };
  lookup.update(absent, true, false);
  assert.deepEqual(await actions.playlist(absent), [{ source: "stream", song: absent.song }]);
  await actions.download(absent);
  assert.deepEqual(downloads, [
    { kind: "delete", track: file },
    { kind: "stream", song: absent.song },
  ]);
});

test("Dislike acts on the captured song, as the Library's when the Library has it, and settles once it is saved", async () => {
  const lookup = createNowPlayingSongLookup({
    read: async () => ({ track: missing, favorite: false, pendingFavorite: false }),
  });
  const dislikes: unknown[] = [];
  let saved!: () => void;
  const actions = createNowPlayingSongActions(lookup, {
    download: () => {},
    starred: () => false,
    star: () => {},
    dislike: (captured, answer, on) => {
      dislikes.push([captured.trackId, answer.track?.id, on]);
      return new Promise((resolve) => {
        saved = resolve;
      });
    },
  });
  lookup.update(target, true, false);
  let settled = false;
  const disliking = actions.dislike(target, true).then(() => {
    settled = true;
  });
  lookup.update({ ...target, trackId: "yt:next" }, true, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(dislikes, [["yt:one", 7, true]]);
  assert.equal(settled, false);
  saved();
  await disliking;
  const removing = actions.dislike(target, false);
  await new Promise((resolve) => setImmediate(resolve));
  saved();
  await removing;
  assert.deepEqual(dislikes.at(-1), ["yt:one", 7, false]);
});

test("an entry with no song to dislike by, neither the Library's nor a video, is left alone", async () => {
  const lookup = createNowPlayingSongLookup({
    read: async () => ({ track: null, favorite: false, pendingFavorite: false }),
  });
  let dislikes = 0;
  const actions = createNowPlayingSongActions(lookup, {
    download: () => {},
    starred: () => false,
    star: () => {},
    dislike: async () => {
      dislikes++;
    },
  });
  await actions.dislike({ trackId: "41", song: null }, true);
  assert.equal(dislikes, 0);
  await actions.dislike(target, true);
  assert.equal(dislikes, 1);
});
