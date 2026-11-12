import assert from "node:assert/strict";
import { test } from "node:test";
import { indexListDownloads, ytPlaylistDownload, type YtDownloadJournalJob } from "./index.ts";

const job = (id: string, patch: Partial<YtDownloadJournalJob> = {}): YtDownloadJournalJob => ({
  id,
  song: {
    videoId: id,
    title: id,
    artists: ["Artist"],
    album: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  },
  phase: "queued",
  ...patch,
});

test("the line advances through saving, ends on completion or cancel, and returns on Retry Failed", () => {
  const members = [
    { kind: "song", videoId: "a" },
    { kind: "song", videoId: "b" },
  ] as const;
  const stages: readonly [readonly YtDownloadJournalJob[], string | null][] = [
    [[job("a"), job("b")], "Downloading · 0 of 2"],
    [
      [
        job("a", { phase: "completed", acknowledged: true, saved: { path: "/a" } }),
        job("b", { phase: "publishing" }),
      ],
      "Downloading · 1 of 2",
    ],
    [
      [
        job("a", { phase: "completed", acknowledged: true, saved: { path: "/a" } }),
        job("b", { phase: "failed" }),
      ],
      null,
    ],
    [
      [
        job("a", { phase: "completed", acknowledged: true, saved: { path: "/a" } }),
        job("b", { resumed: true, phase: "transferring" }),
      ],
      "Downloading · 1 of 2",
    ],
    [[job("a", { phase: "cancelled" }), job("b", { phase: "cancelled" })], null],
  ];
  for (const [jobs, expected] of stages)
    assert.equal(indexListDownloads(jobs).line(members), expected);
  assert.equal(
    indexListDownloads([job("a"), job("b")]).line(members, "pt-BR"),
    "Baixando · 0 de 2",
  );
});

test("byte ticks and queue-to-saving transitions keep the same counting index", () => {
  const before = indexListDownloads([job("a")]);
  assert.equal(
    indexListDownloads([job("a", { phase: "transferring", received: 10 })], before),
    before,
  );
  assert.equal(indexListDownloads([job("a", { phase: "publishing" })], before), before);
  assert.notEqual(indexListDownloads([job("a", { phase: "failed" })], before), before);
});

test("a list counts its own saved entries and shared songs exactly as its page head does", () => {
  const shared = job("shared");
  const jobs = [
    job("saved", { phase: "completed", acknowledged: true, saved: { path: "/saved.flac" } }),
    job("active", { aliases: [shared.song] }),
    job("failed", { phase: "failed" }),
    job("other"),
  ];
  const index = indexListDownloads(jobs);
  const members = [
    { kind: "file", path: "/saved.flac" },
    { kind: "song", videoId: "shared" },
    { kind: "song", videoId: "failed" },
  ] as const;
  assert.equal(index.line(members), "Downloading · 1 of 3");
  assert.equal(
    index.line(members),
    ytPlaylistDownload(
      [
        { source: "library", track: { path: "/saved.flac" } },
        { source: "stream", song: shared.song },
        { source: "stream", song: job("failed").song },
      ],
      { jobs, inLibrary: () => false },
    ).line,
  );
  assert.equal(index.line([{ kind: "song", videoId: "other" }]), "Downloading · 0 of 1");
  assert.equal(index.line([{ kind: "file", path: "/old.flac" }]), null);
});
