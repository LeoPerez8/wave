import assert from "node:assert/strict";
import { test } from "node:test";
import type { YtDownloadJournalJob } from "@wave/core";
import { makeExternalStore } from "../lib/externalStore.ts";
import { createListDownloadProgressStore } from "./listDownloadProgressStore.ts";

const job = (id: string, patch: Partial<YtDownloadJournalJob> = {}): YtDownloadJournalJob => ({
  id,
  song: {
    videoId: id,
    title: id,
    artists: [],
    album: null,
    durationMs: null,
    artworkUrl: null,
    explicit: false,
  },
  phase: "queued",
  ...patch,
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("visible lists share a membership read, and byte ticks never read or notify unrelated rows", async () => {
  const journal = makeExternalStore<readonly YtDownloadJournalJob[]>([job("a"), job("b")]);
  let reads = 0;
  const progress = createListDownloadProgressStore({
    journal,
    subscribeMembership: () => () => {},
    read: async () => {
      reads++;
      return new Map([
        ["playlist:1", [{ kind: "song", videoId: "a" }]],
        ["playlist:2", [{ kind: "song", videoId: "b" }]],
        ["album:1", [{ kind: "song", videoId: "a" }]],
      ]);
    },
  });
  let idle = 0;
  let first = 0;
  const stops = [
    progress.subscribe("playlist:1", () => first++),
    progress.subscribe("playlist:3", () => idle++),
    progress.subscribe("album:1", () => {}),
  ];
  await flush();
  assert.equal(progress.get("playlist:1", "en"), "Downloading · 0 of 1");
  assert.equal(progress.get("playlist:2", "pt-BR"), "Baixando · 0 de 1");
  assert.equal(progress.get("album:1", "en"), "Downloading · 0 of 1");
  journal.set([job("a", { phase: "transferring", received: 50 }), job("b")]);
  await flush();
  assert.equal(reads, 1);
  assert.equal(first, 1);
  assert.equal(idle, 0);
  journal.set([job("a", { phase: "cancelled" }), job("b")]);
  await flush();
  assert.equal(progress.get("playlist:1", "en"), null);
  assert.equal(progress.get("playlist:2", "en"), "Downloading · 0 of 1");
  for (const stop of stops) stop();
  assert.equal(journal.listenerCount(), 0);
});

test("saved entries advance an open list and completion, cancellation and retry restore the right line", async () => {
  const journal = makeExternalStore<readonly YtDownloadJournalJob[]>([job("a"), job("b")]);
  const changed = makeExternalStore(0);
  let landed = false;
  const progress = createListDownloadProgressStore({
    journal,
    subscribeMembership: changed.subscribe,
    read: async () =>
      new Map([
        [
          "playlist:1",
          [
            landed ? { kind: "file", path: "/a" } : { kind: "song", videoId: "a" },
            { kind: "song", videoId: "b" },
          ],
        ],
      ]),
  });
  const stop = progress.subscribe("playlist:1", () => {});
  await flush();
  landed = true;
  changed.set(1);
  journal.set([
    job("a", { phase: "completed", acknowledged: true, saved: { path: "/a" } }),
    job("b"),
  ]);
  await flush();
  assert.equal(progress.get("playlist:1", "en"), "Downloading · 1 of 2");
  journal.set([
    job("a", { phase: "completed", acknowledged: true, saved: { path: "/a" } }),
    job("b", { phase: "failed" }),
  ]);
  await flush();
  assert.equal(progress.get("playlist:1", "en"), null);
  journal.set([
    job("a", { phase: "completed", acknowledged: true, saved: { path: "/a" } }),
    job("b"),
  ]);
  await flush();
  assert.equal(progress.get("playlist:1", "en"), "Downloading · 1 of 2");
  journal.set([
    job("a", { phase: "completed", acknowledged: true, saved: { path: "/a" } }),
    job("b", { phase: "cancelled" }),
  ]);
  await flush();
  assert.equal(progress.get("playlist:1", "en"), null);
  stop();
});

test("an old membership read cannot undo a playlist edit or a hidden screen, and a failed read retries", async () => {
  const journal = makeExternalStore<readonly YtDownloadJournalJob[]>([job("a")]);
  const changed = makeExternalStore(0);
  type Members = import("../library/db/listDownloadMembers.ts").DownloadListMembers;
  let resolve: (members: Members) => void = () => {};
  let reads = 0;
  const members: Members = new Map([["playlist:1", [{ kind: "song", videoId: "a" }]]]);
  const progress = createListDownloadProgressStore({
    journal,
    subscribeMembership: changed.subscribe,
    read: () => {
      reads++;
      if (reads === 1)
        return new Promise<Members>((done) => {
          resolve = done;
        });
      if (reads === 2) return Promise.reject(new Error("read failed"));
      return Promise.resolve(new Map());
    },
  });
  const stop = progress.subscribe("playlist:1", () => {});
  await flush();
  changed.set(1);
  resolve(members);
  await flush();
  assert.equal(progress.get("playlist:1", "en"), null);
  assert.equal(reads, 2);
  changed.set(2);
  await flush();
  assert.equal(reads, 3);
  stop();
  changed.set(3);
  journal.set([job("b")]);
  await flush();
  assert.equal(reads, 3);
  assert.equal(changed.listenerCount(), 0);
  const stopAgain = progress.subscribe("playlist:1", () => {});
  await flush();
  assert.equal(reads, 4);
  stopAgain();
});
