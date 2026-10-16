import assert from "node:assert/strict";
import { test } from "node:test";

import { ytDownloadsToForget } from "./index.ts";
import type { YtDownloadJournalJob } from "./index.ts";

const job = (id: string, patch: Partial<YtDownloadJournalJob> = {}): YtDownloadJournalJob => ({
  id,
  song: {
    videoId: id,
    title: "Song",
    artists: ["Artist"],
    album: "Album",
    durationMs: 180_000,
    artworkUrl: null,
    explicit: false,
  },
  phase: "completed",
  acknowledged: true,
  saved: { path: `/music/${id}.m4a` },
  ...patch,
});

test("a finished download is forgotten when its song leaves the Library", () => {
  assert.deepEqual(ytDownloadsToForget([job("deleted")], []), ["deleted"]);
});

test("a finished download keeps its status while its file is still in the Library", () => {
  assert.deepEqual(
    ytDownloadsToForget(
      [job("kept")],
      [{ id: 1, path: "/music/kept.m4a", title: "Song", artist: "Artist", durationMs: 180_000 }],
    ),
    [],
  );
});

test("active downloads, unacknowledged imports and failures are never forgotten", () => {
  const jobs = [
    job("queued", { phase: "queued", acknowledged: false }),
    job("transferring", { phase: "transferring", acknowledged: false }),
    job("publishing", { phase: "publishing", acknowledged: false }),
    job("importing", { acknowledged: false }),
    job("failed", { phase: "failed", acknowledged: false, reason: "offline" }),
    job("importFailed", { acknowledged: false, importFailure: "storage" }),
  ];
  assert.deepEqual(ytDownloadsToForget(jobs, []), []);
});

test("moving a finished song keeps its download while another recording does not", () => {
  const library = [
    { id: 1, path: "/new/Song.m4a", title: "Song", artist: "Artist", durationMs: 180_000 },
  ];
  assert.deepEqual(
    ytDownloadsToForget(
      [job("moved"), job("live", { song: { ...job("live").song, title: "Song (Live)" } })],
      library,
    ),
    ["live"],
  );
});

test("a vanished file forgets its done status even when sync keeps its missing song", () => {
  assert.deepEqual(
    ytDownloadsToForget(
      [job("missing:1")],
      [{ id: 1, path: null, title: "Song", artist: "Artist", durationMs: 180_000 }],
    ),
    ["missing:1"],
  );
});

test("the journal is kept until the Library has been read", () => {
  assert.deepEqual(ytDownloadsToForget([job("waiting")], null), []);
});

test("a missing song's finished job follows its Track when its file moves and its tags change", () => {
  assert.deepEqual(
    ytDownloadsToForget(
      [job("missing:7")],
      [
        {
          id: 7,
          path: "/new/corrected.m4a",
          title: "Corrected",
          artist: "Artist",
          durationMs: 180_000,
        },
      ],
    ),
    [],
  );
});
