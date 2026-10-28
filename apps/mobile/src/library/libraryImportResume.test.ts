import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import {
  NO_YT_LIBRARY_READS,
  queueYtLibraryReads,
  ytLibraryReadDone,
  ytLibraryReadFailed,
  ytLibraryDownloadsQueued,
  type YtLibraryRead,
  type YtAlbumSong,
  planLinkImport,
  startPlaylistImport,
} from "@wave/core";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "./db/fastAgainFixture.ts";
import { finishLinkImport } from "./startupJobs.ts";
import { resumeLibraryReads } from "./libraryImportResume.ts";
const root = fileURLToPath(new URL("../../../../", import.meta.url));

test("library resume waits between actual items, pauses offline without consuming them, keeps failure/retry order and filled downloads", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const lists = ["First", "Failed", "Last"].map((name) =>
      Effect.runSync(store.createPlaylist(name, [])),
    );
    let batch = queueYtLibraryReads(
      NO_YT_LIBRARY_READS,
      lists.map(({ playlistId, name }) => ({
        playlistId,
        name,
        source: `PL${name}`,
        capped: true,
        favorites: false,
      })),
    );
    let online = false;
    const events: string[] = [],
      turns: (() => void)[] = [];
    const run = () =>
      resumeLibraryReads({
        turn: () =>
          new Promise((resolve) => {
            turns.push(resolve);
          }),
        batch: () => batch,
        prune: async () => {
          events.push("prune");
          await Effect.runPromise(store.listPlaylists);
        },
        settle: async (id) => {
          events.push(`settle:${id}`);
        },
        download: async (read) => {
          events.push(`download:${read.name}`);
          batch = ytLibraryDownloadsQueued(batch, read);
        },
        fill: async (read) => {
          events.push(`read:${read.name}`);
          if (!online) return "offline";
          if (read.name === "Failed") {
            batch = ytLibraryReadFailed(batch, read, "transport failed").batch;
            return null;
          }
          const plan = planLinkImport<YtAlbumSong, never>(
            {
              service: "spotify",
              playlist: {
                title: read.name,
                artworkUrl: null,
                total: 1,
                truncated: false,
                songs: [{ title: read.name, artists: ["A"], album: null, durationMs: 1000 }],
              },
            },
            [],
          );
          await Effect.runPromise(
            finishLinkImport(store, startPlaylistImport(plan, read), Effect.void),
          );
          batch = ytLibraryReadDone(batch, read);
          return null;
        },
        paused: (read, reason) => events.push(`${read.name}:${reason}`),
      });
    const drain = async (promise: Promise<void>) => {
      let done = false;
      void promise.then(() => {
        done = true;
      });
      for (let i = 0; i < 30; i++) {
        if (done) break;
        turns.shift()?.();
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.equal(done, true);
      await promise;
    };
    const paused = run();
    assert.deepEqual(events, []);
    await drain(paused);
    assert.deepEqual(events, ["prune", "read:First", "First:offline"]);
    assert.deepEqual(
      batch.reads.map((r) => r.state),
      ["waiting", "waiting", "waiting"],
    );
    online = true;
    events.length = 0;
    await drain(run());
    assert.deepEqual(events, ["prune", "read:First", "read:Failed", "read:Last"]);
    assert.deepEqual(
      batch.reads.map((r) => [r.name, r.state]),
      [["Failed", "failed"]],
    );
    for (const [index, name] of [
      [0, "First"],
      [2, "Last"],
    ] as const) {
      const items = Effect.runSync(store.getPlaylist(lists[index]!.playlistId))!.items;
      assert.equal(items.length, 1);
      assert.equal(items[0]!.source === "unsearched" && items[0]!.song.title, name);
    }
    const filled: YtLibraryRead = {
      token: batch.lastToken + 1,
      source: "PLfilled",
      playlistId: lists[0]!.playlistId,
      name: "Filled",
      favorites: false,
      capped: true,
      download: true,
      expected: null,
      state: "filled",
    };
    batch = { ...batch, reads: [filled, ...batch.reads], lastToken: filled.token };
    events.length = 0;
    await drain(run());
    assert.deepEqual(events, ["prune", `settle:${filled.playlistId}`, "download:Filled"]);
    assert.deepEqual(
      batch.reads.map((r) => r.name),
      ["Failed"],
    );
  } finally {
    fixture.close();
  }
});
