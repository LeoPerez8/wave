import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogueOf, type YtSong } from "@wave/core";

import { geniusHitMenu, geniusHitOpener, resolveGeniusHit } from "./geniusHitMenu.ts";

const hit = {
  id: 8,
  title: "Teardrop",
  artist: "Massive Attack",
  credit: "Massive Attack",
  url: "https://genius.com/Massive-attack-teardrop-lyrics",
  artworkUrl: "https://images.example/teardrop.jpg",
};
const track = {
  id: 5,
  title: "Teardrop",
  artist: "Massive Attack",
  album: "Mezzanine",
  durationMs: 330_000,
};
const online: YtSong = {
  videoId: "teardrop",
  title: "Teardrop",
  artists: ["Massive Attack"],
  album: "Mezzanine",
  durationMs: 330_000,
  artworkUrl: null,
  explicit: false,
};

/** Each effect records what it was asked to do. */
const recorder = () => {
  const done: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      void done.push([name, ...args]);
  return {
    done,
    effects: {
      play: record("play"),
      playNext: record("playNext"),
      addToPlaylist: record("addToPlaylist"),
      goToAlbum: record("goToAlbum"),
      download: record("download"),
      cancelDownload: record("cancelDownload"),
      openUrl: record("openUrl"),
    },
  };
};

const lookup = (library: readonly (typeof track)[], songs: readonly YtSong[], ytMusic = true) => {
  const searched: string[] = [];
  return {
    searched,
    ports: {
      library: async () => library,
      ytMusic: () => ytMusic,
      search: async (_asker: unknown, query: string) => {
        searched.push(query);
        return { ok: true as const, songs };
      },
    },
  };
};

test("a long-pressed Library song offers its Recognize actions and Open in Genius", async () => {
  const { ports, searched } = lookup([track], []);
  const result = await resolveGeniusHit(ports, hit, new AbortController().signal);
  const { done, effects } = recorder();
  const menu = geniusHitMenu(hit, result, { ytMusic: true }, catalogueOf("en"), effects);
  assert.deepEqual(searched, []);
  assert.deepEqual(
    menu.map((entry) => entry.label),
    ["Play", "Play Next", "Add to Playlist", "Go to Album", "Open in Genius"],
  );
  for (const entry of menu) entry.run();
  assert.deepEqual(done, [
    ["play", { source: "library", track }],
    ["playNext", { source: "library", track }],
    ["addToPlaylist", result],
    ["goToAlbum", track],
    ["openUrl", hit.url],
  ]);
});

test("a long-pressed song found online plays and downloads its stream", async () => {
  const { ports, searched } = lookup([], [online]);
  const result = await resolveGeniusHit(ports, hit, new AbortController().signal);
  const { done, effects } = recorder();
  const menu = geniusHitMenu(hit, result, { ytMusic: true }, catalogueOf("pt-BR"), effects);
  assert.deepEqual(searched, ["Teardrop Massive Attack"]);
  assert.deepEqual(
    menu.map((entry) => entry.action),
    ["play", "playNext", "addToPlaylist", "download", "openInGenius"],
  );
  assert.equal(menu.at(-1)?.label, "Abrir no Genius");
  for (const entry of menu) entry.run();
  assert.deepEqual(done, [
    ["play", { source: "stream", song: online }],
    ["playNext", { source: "stream", song: online }],
    ["addToPlaylist", result],
    ["download", online],
    ["openUrl", hit.url],
  ]);
});

test("a song not found online still offers Add to Playlist and Open in Genius", async () => {
  const { ports } = lookup([], []);
  const result = await resolveGeniusHit(ports, hit, new AbortController().signal);
  assert.equal(result.kind, "unavailable");
  const { effects } = recorder();
  assert.deepEqual(
    geniusHitMenu(hit, result, { ytMusic: true }, catalogueOf("en"), effects).map(
      (entry) => entry.action,
    ),
    ["addToPlaylist", "openInGenius"],
  );
});

test("with YT Music off nothing is searched and online playback and downloads are hidden", async () => {
  const { ports, searched } = lookup([], [online], false);
  const result = await resolveGeniusHit(ports, hit, new AbortController().signal);
  const { effects } = recorder();
  assert.deepEqual(searched, []);
  assert.deepEqual(
    geniusHitMenu(hit, result, { ytMusic: false }, catalogueOf("en"), effects).map(
      (entry) => entry.action,
    ),
    ["addToPlaylist", "openInGenius"],
  );
});

test("a lookup that fails still opens the menu with Add to Playlist and Open in Genius", async () => {
  const result = await resolveGeniusHit(
    {
      library: async () => {
        throw new Error("Library unreadable");
      },
      ytMusic: () => true,
      search: async () => null,
    },
    hit,
    new AbortController().signal,
  );
  assert.equal(result.kind, "unsearched");
  assert.equal(result.song.title, "Teardrop");
  const { effects } = recorder();
  assert.deepEqual(
    geniusHitMenu(hit, result, { ytMusic: true }, catalogueOf("en"), effects).map(
      (entry) => entry.action,
    ),
    ["addToPlaylist", "openInGenius"],
  );
});

test("a download under way offers Cancel Download for the streamed song", async () => {
  const { ports } = lookup([], [online]);
  const result = await resolveGeniusHit(ports, hit, new AbortController().signal);
  const { done, effects } = recorder();
  const menu = geniusHitMenu(
    hit,
    result,
    { ytMusic: true, status: { kind: "queued" } },
    catalogueOf("en"),
    effects,
  );
  const cancel = menu.find((entry) => entry.action === "cancelDownload");
  assert.equal(cancel?.label, "Cancel Download");
  cancel?.run();
  assert.deepEqual(done, [["cancelDownload", online]]);
});

/** A tap's effects, recorded in order. */
const tapRecorder = () => {
  const done: unknown[][] = [];
  return {
    done,
    effects: {
      play: (song: unknown) => void done.push(["play", song]),
      openUrl: (url: string) => void done.push(["openUrl", url]),
      pending: (pending: { readonly id: number } | null) =>
        void done.push(["pending", pending?.id ?? null]),
    },
  };
};

test("a tapped Genius result plays the song it resolves to, as its long press resolves it", async () => {
  const { ports, searched } = lookup([], [online]);
  const { done, effects } = tapRecorder();
  await geniusHitOpener(ports, effects)(hit);
  assert.deepEqual(searched, ["Teardrop Massive Attack"]);
  assert.deepEqual(done, [
    ["pending", 8],
    ["play", { source: "stream", song: online }],
    ["pending", null],
  ]);
});

test("a second tap while the first resolves searches nothing more and plays once", async () => {
  const searched: string[] = [];
  const asked: ((songs: readonly YtSong[]) => void)[] = [];
  const answer = (songs: readonly YtSong[]) => {
    for (const reply of asked.splice(0)) reply(songs);
  };
  const ports = {
    library: async () => [],
    ytMusic: () => true,
    search: (_asker: unknown, query: string) => {
      searched.push(query);
      return new Promise<{ ok: true; songs: readonly YtSong[] }>((resolve) => {
        asked.push((songs) => resolve({ ok: true, songs }));
      });
    },
  };
  const { done, effects } = tapRecorder();
  const open = geniusHitOpener(ports, effects);
  const first = open(hit);
  const second = open(hit);
  await new Promise((resolve) => setImmediate(resolve));
  answer([online]);
  await Promise.all([first, second]);
  assert.deepEqual(searched, ["Teardrop Massive Attack"]);
  assert.deepEqual(done, [
    ["pending", 8],
    ["play", { source: "stream", song: online }],
    ["pending", null],
  ]);

  // Once it has played, the next tap is taken again.
  const again = open(hit);
  await new Promise((resolve) => setImmediate(resolve));
  answer([]);
  await again;
  assert.deepEqual(done.slice(3), [
    ["pending", 8],
    ["openUrl", hit.url],
    ["pending", null],
  ]);
});
