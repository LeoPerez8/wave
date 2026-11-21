import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { createPlaylist, selectPlaylistEntries } from "@wave/client/db/playlists";
import type { LibraryDatabase } from "@wave/client/db/database";
import type { YtAlbumSong } from "@wave/core";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

import type { PlaylistSuggestionsView } from "../../shared/playlistSuggestions.ts";
import { libraryLayer } from "../database.ts";
import { createPlaylistSuggestions, type PlaylistSuggestionsDeps } from "./playlistSuggestions.ts";
import type { YtRadioRead } from "./ytPages.ts";

const song = (n: number): YtAlbumSong => ({
  videoId: `radio${String(n).padStart(6, "0")}`,
  title: `Radio Song ${n}`,
  artists: [`Radio Artist ${n}`],
  album: null,
  albumId: null,
  durationMs: 200_000 + n * 1_000,
  artworkUrl: null,
  explicit: false,
});
const RADIO: YtRadioRead = {
  status: "ok",
  songs: Array.from({ length: 30 }, (_, n) => song(n)),
  continuation: null,
};

/** A Library with a playlist of three songs, and the suggestions over it with YT Music faked. */
const setUp = async (
  run: (context: {
    readonly db: LibraryDatabase;
    readonly playlistId: number;
    readonly world: { yt: boolean; online: boolean; radio: () => Promise<YtRadioRead> };
    readonly asked: string[];
    readonly changes: () => number;
    readonly make: () => ReturnType<typeof createPlaylistSuggestions>;
  }) => Promise<void>,
) => {
  const folder = mkdtempSync(join(tmpdir(), "wave-suggestions-"));
  const runtime = ManagedRuntime.make(libraryLayer(join(folder, "wave.db")));
  try {
    const db = (await runtime.runPromise(
      Effect.gen(function* () {
        return yield* Database;
      }),
    )) as unknown as LibraryDatabase;
    const ids = ["One", "Two", "Three"].map((title) =>
      addTrack(db as unknown as TestDatabase, { title, artist: `Seed ${title}` }),
    );
    const { playlistId } = createPlaylist(
      db,
      "Mine",
      ids.map((trackId) => ({ source: "library", trackId })),
      1,
    );
    const world = { yt: true, online: true, radio: async () => RADIO };
    const asked: string[] = [];
    let changes = 0;
    const deps: PlaylistSuggestionsDeps = {
      db,
      ytMusic: () => world.yt,
      online: () => world.online,
      changed: () => void changes++,
      pages: {
        findSong: async (key) => {
          asked.push(`findSong ${key.title}`);
          return `seed${key.title}`;
        },
        songRadio: async (videoId) => {
          asked.push(`songRadio ${videoId}`);
          return world.radio();
        },
        findArtist: async () => ({ status: "ok", browseId: null }),
        artistRadio: async () => ({ status: "ok", songs: [], continuation: null }),
      },
      log: () => {},
    };
    await run({
      db,
      playlistId,
      world,
      asked,
      changes: () => changes,
      make: () => createPlaylistSuggestions(deps),
    });
  } finally {
    await runtime.dispose();
    rmSync(folder, { recursive: true, force: true });
  }
};

type Shown = Extract<PlaylistSuggestionsView, { shown: true }>;
const shown = (view: PlaylistSuggestionsView): Shown => {
  assert.equal(view.shown, true);
  return view as Shown;
};
/** The view once nothing loads and no slot is busy. */
const settledView = async (
  suggestions: ReturnType<typeof createPlaylistSuggestions>,
  playlistId: number,
  sources = "1",
): Promise<Shown> => {
  for (let i = 0; i < 500; i++) {
    const view = shown(suggestions.view(playlistId, sources));
    if (!view.loading && view.slots.every((slot) => slot.kind !== "busy")) return view;
    await setImmediate();
  }
  assert.fail("the suggestions never settled");
};
const offers = (view: Shown) => view.slots.flatMap((slot) => (slot.kind === "offer" ? [slot] : []));
const videos = (view: Shown) => offers(view).map((slot) => slot.row.videoId);

test("with YT Music off the section isn't shown and nothing is read", async () => {
  await setUp(async ({ playlistId, world, asked, make }) => {
    world.yt = false;
    const suggestions = make();
    assert.deepEqual(suggestions.view(playlistId, "1"), { shown: false });
    for (let i = 0; i < 20; i++) await setImmediate();
    assert.deepEqual(suggestions.view(playlistId, "1"), { shown: false });
    assert.deepEqual(asked, []);
  });
});

test("an editable playlist shows five recommended songs from its songs' radios", async () => {
  await setUp(async ({ playlistId, asked, make }) => {
    const suggestions = make();
    const first = shown(suggestions.view(playlistId, "1"));
    assert.equal(first.loading, true);
    const view = await settledView(suggestions, playlistId);
    assert.equal(view.error, null);
    assert.equal(offers(view).length, 5);
    assert.equal(new Set(videos(view)).size, 5);
    assert.ok(videos(view).every((video) => video?.startsWith("radio")));
    assert.equal(view.offered, true);
    assert.ok(asked.some((line) => line.startsWith("songRadio")));
  });
});

test("Add appends the song to the playlist and its slot takes another offer", async () => {
  await setUp(async ({ db, playlistId, changes, make }) => {
    const suggestions = make();
    const before = await settledView(suggestions, playlistId);
    const [first] = offers(before);
    assert.ok(first);
    const adding = suggestions.add(playlistId, first.key);
    const busy = shown(suggestions.view(playlistId, "1"));
    assert.deepEqual(busy.slots[0], { kind: "busy", action: "add", title: first.row.title });
    assert.equal(await adding, true);
    const after = await settledView(suggestions, playlistId);
    const entries = selectPlaylistEntries(db, playlistId);
    const last = entries.at(-1);
    assert.equal(last?.source, "stream");
    assert.equal(last?.source === "stream" ? last.song.videoId : null, first.row.videoId);
    assert.equal(offers(after).length, 5);
    assert.ok(!videos(after).includes(first.row.videoId));
    assert.deepEqual(videos(after).slice(1), videos(before).slice(1));
    assert.ok(changes() > 0, "the playlist's page reads the new song");
  });
});

test("Dismiss removes the offer, keeps the playlist and fills the slot", async () => {
  await setUp(async ({ db, playlistId, make }) => {
    const suggestions = make();
    const before = await settledView(suggestions, playlistId);
    const second = offers(before)[1]!;
    assert.equal(await suggestions.dismiss(playlistId, second.key), true);
    const after = await settledView(suggestions, playlistId);
    assert.equal(selectPlaylistEntries(db, playlistId).length, 3);
    assert.equal(offers(after).length, 5);
    assert.ok(!videos(after).includes(second.row.videoId));
    assert.equal(videos(after)[0], videos(before)[0]);
  });
});

test("reopening the playlist shows its saved offers at once, with no loading", async () => {
  await setUp(async ({ playlistId, world, make }) => {
    const first = make();
    const seen = videos(await settledView(first, playlistId));
    first.close(playlistId);
    // The renewal behind the offers waits on its radios: the offers show without it.
    world.radio = () => new Promise(() => {});
    const again = shown(make().view(playlistId, "1"));
    assert.equal(again.loading, false);
    assert.deepEqual(videos(again), seen);
  });
});

test("Refresh swaps every offer showing for others", async () => {
  await setUp(async ({ playlistId, make }) => {
    const suggestions = make();
    const before = videos(await settledView(suggestions, playlistId));
    assert.equal(await suggestions.refresh(playlistId), "updated");
    const after = videos(await settledView(suggestions, playlistId));
    assert.equal(after.length, 5);
    assert.deepEqual(
      after.filter((video) => before.includes(video)),
      [],
    );
  });
});

test("a failed read shows the failure with Try Again, which asks afresh", async () => {
  await setUp(async ({ playlistId, world, make }) => {
    world.radio = async () => ({ status: "failed", songs: [], continuation: null });
    const suggestions = make();
    const failed = await settledView(suggestions, playlistId);
    assert.equal(failed.error, "load");
    assert.deepEqual(offers(failed), []);
    world.radio = async () => RADIO;
    suggestions.retry(playlistId, false);
    const view = await settledView(suggestions, playlistId);
    assert.equal(view.error, null);
    assert.equal(offers(view).length, 5);
  });
});

test("turning YT Music off stops the visit; a call for another playlist is refused", async () => {
  await setUp(async ({ playlistId, world, make }) => {
    const suggestions = make();
    await settledView(suggestions, playlistId);
    world.yt = false;
    assert.deepEqual(suggestions.view(playlistId, "1"), { shown: false });
    assert.equal(await suggestions.add(playlistId + 1, "nope"), false);
    assert.equal(await suggestions.refresh(playlistId + 1), null);
  });
});
