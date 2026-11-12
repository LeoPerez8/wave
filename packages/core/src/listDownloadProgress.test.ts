import assert from "node:assert/strict";
import { test } from "node:test";
import {
  albumDownloadMembers,
  albumDownloadOrigin,
  indexListDownloads,
  ytAlbumDownload,
  ytPlaylistDownload,
  type YtDownloadJournalJob,
} from "./index.ts";

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

const albumOfPath = (path: string): number | null => (path === "/One/a.mp3" ? 7 : null);

test("a Library album counts the songs its YT Music album asked for once one is saved, as the album page head does", () => {
  const origin = { kind: "album", id: "MPREb_one", name: "One" } as const;
  const onAlbum = (id: string) => ({ ...job(id).song, albumId: "MPREb_one" });
  const jobs = [
    job("a", { origin, phase: "completed", acknowledged: true, saved: { path: "/One/a.mp3" } }),
    job("b", { origin }),
    job("c", { origin, phase: "failed" }),
    // Asked for on its own before the album was: it keeps its job, and the album still counts it.
    job("d", { song: onAlbum("d") }),
    job("e", { song: onAlbum("e"), origin, phase: "cancelled" }),
    job("elsewhere", { origin: { kind: "album", id: "MPREb_two", name: "Two" } }),
  ];
  const index = indexListDownloads(jobs);
  const members = albumDownloadMembers(index.albumSongs, albumOfPath);
  assert.deepEqual([...members.keys()], [7]);
  assert.equal(index.line(members.get(7) ?? []), "Downloading · 1 of 4");
  assert.equal(
    index.line(members.get(7) ?? []),
    ytAlbumDownload(
      ["a", "b", "c", "d", "e", "never asked"].map((id) => job(id).song),
      { jobs, inLibrary: () => false },
    ).line,
  );
  // Before its first song is saved the Library has no album to show it on.
  assert.equal(
    albumDownloadMembers(indexListDownloads(jobs.slice(1)).albumSongs, albumOfPath).size,
    0,
  );
});

test("a Library album's own download counts from its first request, and two albums keep their own counts", () => {
  const first = albumDownloadOrigin({ id: 3, title: "First" });
  const second = albumDownloadOrigin({ id: 4, title: "Second" });
  const index = indexListDownloads([
    job("a", { origin: first }),
    job("b", { origin: first }),
    job("c", { origin: second, phase: "completed", acknowledged: true, saved: { path: "/c" } }),
    job("d", { origin: second }),
    job("e", { origin: second }),
    job("p", { origin: { kind: "playlist", id: "3", name: "Playlist" } }),
  ]);
  const members = albumDownloadMembers(index.albumSongs, () => null);
  assert.equal(index.line(members.get(3) ?? []), "Downloading · 0 of 2");
  assert.equal(index.line(members.get(4) ?? [], "pt-BR"), "Baixando · 1 de 3");
  assert.deepEqual([...members.keys()].toSorted(), [3, 4]);
});
