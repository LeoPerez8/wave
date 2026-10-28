import assert from "node:assert/strict";
import { test } from "node:test";

import { songRowTrackId, songRowView, type SongRowSource, type YtDownloadStatus } from "./index.ts";

const librarySong = {
  id: 42,
  title: "One More Time",
  artist: "Daft Punk",
  durationMs: 320000,
  path: "/music/one.flac",
  thumbPath: "/art/one-thumb.jpg",
  explicit: "clean" as const,
};

test("a Library row keeps its credit, length, downloaded badge and spoken order", () => {
  const view = songRowView({ kind: "library", song: librarySong });
  assert.equal(view.key, "42");
  assert.equal(view.recycleType, "librarySong");
  assert.equal(view.title, "One More Time");
  assert.equal(view.secondLine, "Daft Punk");
  assert.equal(view.trailingText, "5:20");
  assert.deepEqual(view.badges, { explicit: false, downloaded: true });
  assert.deepEqual(view.artwork, { kind: "file", files: { thumbPath: "/art/one-thumb.jpg" } });
  assert.equal(view.accessibilityLabel, "One More Time, Daft Punk, downloaded");
  assert.equal(view.disabled, false);
  assert.equal(view.dimmed, false);
});

test("missing songs stay dimmed through every download stage, with credit before download speech", () => {
  const stages: readonly [YtDownloadStatus | null, string | null, number | null][] = [
    [null, null, null],
    [{ kind: "queued" }, "Waiting to download", null],
    [{ kind: "downloading", received: 1, total: null }, "Downloading", null],
    [{ kind: "downloading", received: 25, total: 100 }, "Downloading · 25%", 0.25],
    [{ kind: "downloading", received: 200, total: 100 }, "Downloading · 100%", 1],
    [{ kind: "downloading", received: 0, total: null, phase: "connecting" }, "Connecting", null],
    [
      { kind: "downloading", received: 0, total: null, phase: "searching" },
      "Finding this recording",
      null,
    ],
    [
      { kind: "downloading", received: 0, total: null, phase: "queued" },
      "Waiting to download",
      null,
    ],
    [
      { kind: "downloading", received: 0, total: null, phase: "validating" },
      "Checking the download",
      null,
    ],
    [{ kind: "saving" }, "Saving to the Library", null],
    [{ kind: "failed", reason: "offline" }, "Download failed: offline", null],
    [{ kind: "failed", reason: "notFound" }, "Not found online", null],
    [{ kind: "done", path: "/music/new.m4a" }, "In the Library", null],
  ];
  for (const [download, line, progress] of stages) {
    for (const source of [
      { kind: "missing", song: librarySong },
      { kind: "library", song: { ...librarySong, path: null } },
      { kind: "librarySummary", song: { ...librarySong, hasFile: false } },
    ] as const) {
      const view = songRowView(source, { download });
      assert.equal(view.secondLine, line ?? "Daft Punk");
      assert.equal(view.downloadLine, line);
      assert.equal(view.progress, progress);
      assert.equal(view.dimmed, true);
      assert.equal(view.disabled, false);
      assert.equal(view.badges.downloaded, false);
      assert.equal(
        view.accessibilityLabel,
        `One More Time, Daft Punk, ${line ?? "not downloaded"}`,
      );
    }
  }
});

test("YT and unsearched rows speak their download line instead of credit; album numbering keeps artists only", () => {
  const source = { kind: "ytMusic", song: ytSong } as const;
  const numbered = songRowView(source, {
    leading: { kind: "trackNumber", number: 3 },
    kindLine: true,
  });
  assert.equal(numbered.secondLine, "Song · Daft Punk & Guest");
  const ranked = songRowView(source, { leading: { kind: "rank", number: 3 } });
  assert.equal(ranked.secondLine, "Daft Punk & Guest · Discovery");
  for (const kind of ["ytMusic", "unsearched"] as const) {
    const view = songRowView(
      { kind, song: ytSong },
      { download: { kind: "queued" }, kindLine: true },
    );
    assert.equal(view.secondLine, "Waiting to download");
    assert.equal(
      view.accessibilityLabel,
      kind === "ytMusic"
        ? "One More Time, Waiting to download, explicit"
        : "One More Time, Waiting to download",
    );
  }
});

test("file not found disables a row, replaces its second line and moves its icon with the leading cell", () => {
  const source = { kind: "library", song: librarySong } as const;
  const view = songRowView(source, { fileNotFound: true });
  assert.equal(view.secondLine, "File not found");
  assert.equal(view.disabled, true);
  assert.equal(view.fileNotFound, true);
  assert.equal(view.fileNotFoundIcon, "trailing");
  assert.equal(view.badges.downloaded, false);
  assert.equal(view.accessibilityLabel, "One More Time, Daft Punk");
  const numbered = songRowView(source, {
    fileNotFound: true,
    leading: { kind: "trackNumber", number: 1 },
  });
  assert.equal(numbered.fileNotFoundIcon, "leading");
});

const ytSong = {
  videoId: "video-1",
  title: "One More Time",
  artists: ["Daft Punk", "Guest"],
  album: "Discovery",
  durationMs: null,
  artworkUrl: "https://img/one.jpg",
  explicit: true,
};

test("each source preserves its current row's text and spoken label", () => {
  const cases: readonly [SongRowSource, string, string, string, string][] = [
    [
      { kind: "librarySummary", song: { ...librarySong, hasFile: true } },
      "42",
      "librarySong",
      "Daft Punk",
      "One More Time, Daft Punk, downloaded",
    ],
    [
      { kind: "missing", song: librarySong },
      "42",
      "librarySong",
      "Daft Punk",
      "One More Time, Daft Punk, not downloaded",
    ],
    [
      { kind: "ytMusic", song: ytSong },
      "yt:video-1",
      "ytSong",
      "Daft Punk & Guest · Discovery",
      "One More Time, Daft Punk & Guest · Discovery, explicit",
    ],
    [
      { kind: "unsearched", song: ytSong },
      'unsearched:["One More Time",["Daft Punk","Guest"],"Discovery",null]',
      "ytSong",
      "Daft Punk & Guest · Discovery",
      "One More Time, Daft Punk & Guest · Discovery",
    ],
    [
      { kind: "unavailable", song: { ...ytSong, reason: "notFound" } },
      'unavailable:["One More Time",["Daft Punk","Guest"],"Discovery",null]',
      "unavailableEntry",
      "Not found online",
      "One More Time, Not found online, unavailable",
    ],
    [
      { kind: "queue", entry: { key: "q:7", trackId: "42" }, track: librarySong },
      "q:7",
      "queueSong",
      "Daft Punk",
      "One More Time, Daft Punk, downloaded",
    ],
    [
      {
        kind: "history",
        id: 9,
        trackId: "42",
        title: "Original title",
        artist: "Original credit",
        durationMs: 320000,
      },
      "play:9",
      "librarySong",
      "Original credit",
      "Original title, Original credit, downloaded",
    ],
  ];
  for (const [source, key, type, secondLine, label] of cases) {
    const view = songRowView(source);
    assert.equal(view.key, key, source.kind);
    assert.equal(view.recycleType, type, source.kind);
    assert.equal(view.secondLine, secondLine, source.kind);
    assert.equal(view.accessibilityLabel, label, source.kind);
  }
});

test("headers, loading rows and unavailable rows stay in separate recycle pools", () => {
  const disc = songRowView({ kind: "discHeader", key: "disc:2", label: "Disc 2" });
  const loading = songRowView({ kind: "loading", key: "42" });
  assert.equal(disc.recycleType, "discHeader");
  assert.equal(disc.accessibilityLabel, "Disc 2");
  assert.equal(disc.accessibilityRole, "header");
  assert.equal(loading.recycleType, "loadingRow");
  assert.equal(loading.accessibilityLabel, "Loading song");
  assert.equal(loading.disabled, true);
});

test("playing, stars, selection, leading cells and trailing overrides preserve the row's meaning", () => {
  const source = { kind: "library", song: { ...librarySong, explicit: "explicit" } } as const;
  const view = songRowView(source, {
    playing: true,
    starred: true,
    selection: "checked",
    kindLine: true,
    leading: { kind: "rank", number: 1 },
    countedPlays: 12,
  });
  assert.equal(view.playing, true);
  assert.equal(view.starred, true);
  assert.equal(view.secondLine, "Song · Daft Punk");
  assert.equal(view.trailingText, "12 plays");
  assert.deepEqual(view.leading, { kind: "rank", number: 1, top: true });
  assert.equal(view.leading.kind === "rank" && view.leading.top, true);
  assert.equal(
    view.accessibilityLabel,
    "One More Time, Song · Daft Punk, explicit, 12 plays, downloaded, now playing",
  );
  assert.equal(view.accessibilityRole, "checkbox");
  assert.deepEqual(view.accessibilityState, { disabled: false, checked: true });
  for (const [selection, expected] of [
    ["off", { disabled: false, selected: true }],
    ["checked", { disabled: false, checked: true }],
    ["unchecked", { disabled: false, checked: false }],
    ["disabled", { disabled: true, checked: false }],
  ] as const) {
    const row = songRowView(source, { selection, playing: true });
    assert.deepEqual(row.accessibilityState, expected);
    assert.equal(row.disabled, selection === "disabled");
    assert.equal(row.selecting, selection !== "off");
  }
  for (const leading of [
    { kind: "artwork" },
    { kind: "playDisc" },
    { kind: "trackNumber", number: 7 },
    { kind: "trackNumber" },
    { kind: "rank", number: 2 },
  ] as const) {
    const row = songRowView(source, { leading });
    assert.deepEqual(row.leading, leading.kind === "rank" ? { ...leading, top: false } : leading);
  }
  const override = songRowView(source, { trailingLabel: "9:41 AM", countedPlays: 1 });
  assert.equal(override.trailingText, "9:41 AM");
  // TrackRow speaks the override both as the time and as the replaced plays cell.
  assert.equal(
    override.accessibilityLabel,
    "One More Time, Daft Punk, 9:41 AM, explicit, 9:41 AM, downloaded",
  );
});

test("keys survive state changes and distinguish repeated songs and unavailable entries", () => {
  const source = { kind: "ytMusic", song: ytSong } as const;
  assert.equal(songRowView(source, { playing: true, starred: true }).key, "yt:video-1");
  assert.equal(songRowView({ ...source, occurrence: 1 }).key, "yt:video-1:occurrence:1");
  assert.equal(songRowView({ ...source, key: "playlist-item:81" }).key, "playlist-item:81");
  const first = { kind: "unavailable", song: { ...ytSong, reason: "localFile" } } as const;
  assert.equal(songRowView(first).secondLine, "Local file on Spotify");
  assert.notEqual(
    songRowView(first).key,
    songRowView({ ...first, song: { ...first.song, artists: ["Other"] } }).key,
  );
});

test("rows hand every local cover file over for the app's one picker, and hide remote covers when requested", () => {
  for (const [files, expected] of [
    [
      { thumbPath: "/thumb", mediumPath: "/medium", artworkPath: "/original" },
      {
        kind: "file",
        files: { thumbPath: "/thumb", mediumPath: "/medium", artworkPath: "/original" },
      },
    ],
    [
      { thumbPath: null, mediumPath: "/medium", artworkPath: "/original" },
      { kind: "file", files: { mediumPath: "/medium", artworkPath: "/original" } },
    ],
    [
      { thumbPath: null, artworkPath: "/original" },
      { kind: "file", files: { artworkPath: "/original" } },
    ],
    [{ thumbPath: null }, { kind: "placeholder" }],
  ] as const) {
    assert.deepEqual(
      songRowView({ kind: "library", song: { ...librarySong, ...files } }).artwork,
      expected,
    );
  }
  assert.deepEqual(songRowView({ kind: "ytMusic", song: ytSong }).artwork, {
    kind: "remote",
    url: "https://img/one.jpg",
    size: "thumbnail",
  });
  assert.deepEqual(
    songRowView({ kind: "ytMusic", song: ytSong }, { remoteArtwork: false }).artwork,
    { kind: "placeholder" },
  );
});

test("Queue History, unresolved Queue songs and removed listening-history songs retain today's labels", () => {
  const queue = songRowView({
    kind: "queue",
    entry: { key: "q:2", trackId: "42" },
    track: librarySong,
    history: true,
  });
  assert.equal(queue.recycleType, "queueHistory");
  assert.equal(queue.dimmed, true);
  assert.equal(queue.trailingText, "");
  assert.equal(queue.accessibilityLabel, "One More Time, Daft Punk, downloaded");
  const unresolved = songRowView({ kind: "queue", entry: { key: "q:3", trackId: "42" } });
  assert.equal(unresolved.title, " ");
  assert.equal(unresolved.badges.downloaded, false);
  assert.equal(unresolved.accessibilityLabel, "Song, ");
  const removed = songRowView(
    {
      kind: "history",
      id: 3,
      title: "Old song",
      artist: "Old credit",
      durationMs: null,
      unavailable: true,
      disabled: true,
    },
    { trailingLabel: "9:41 AM" },
  );
  assert.equal(removed.disabled, true);
  assert.equal(removed.dimmed, true);
  assert.equal(removed.trailingText, "9:41 AM");
  assert.equal(removed.accessibilityLabel, "Old song, Old credit, 9:41 AM, unavailable");
});

test("a row's song goes by its queue id; a deleted song's queue entry and a non-song slot by none", () => {
  assert.equal(songRowTrackId({ kind: "library", song: librarySong }), "42");
  assert.equal(
    songRowTrackId({
      kind: "queue",
      entry: { key: "q1", trackId: "42" },
      track: { title: "One More Time", artist: "Daft Punk" },
    }),
    "42",
  );
  assert.equal(
    songRowTrackId({ kind: "queue", entry: { key: "q1", trackId: "42" }, track: undefined }),
    "",
  );
  assert.equal(songRowTrackId({ kind: "loading", key: "3" }), null);
});
