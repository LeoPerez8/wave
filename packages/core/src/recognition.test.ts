import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RECOGNIZE_CARD_ACTION_LABELS,
  recognizeCardView,
  recognizeLogLine,
  readPlaylistEntrySong,
  writePlaylistEntrySong,
  recognizePlaylistSong,
  recognizeResultActions,
  resolveRecognizedSong,
  type RecognizedSong,
} from "./index.ts";

const heard: RecognizedSong = {
  title: "Deja Vu (feat. Guest)",
  artist: "Beyonce feat. Guest",
  album: "Heard album",
  coverUrl: "https://shazam/cover",
  isrc: null,
  releaseYear: null,
};
const track = {
  id: 42,
  title: "Déjà Vu",
  artist: "BEYONCÉ",
  album: "Library album",
  durationMs: 99_000,
};

test("recognition prefers the Library by title and a shared artist, without a length tie-break", () => {
  assert.deepEqual(resolveRecognizedSong(heard, [track]), {
    kind: "resolved",
    lookup: "library",
    result: {
      kind: "library",
      track,
      song: {
        title: "Déjà Vu",
        artists: ["BEYONCÉ"],
        album: "Library album",
        durationMs: 99_000,
        artworkUrl: "https://shazam/cover",
      },
    },
  });
});

test("a song outside the Library asks for one title and artist search", () => {
  assert.deepEqual(resolveRecognizedSong(heard, [{ ...track, artist: "Someone else" }]), {
    kind: "search",
    query: "Deja Vu (feat. Guest) Beyonce feat. Guest",
  });
});

const onlineSong = {
  videoId: "found",
  title: "DÉJÀ VU",
  artists: ["Beyoncé"],
  album: "Online album",
  durationMs: 300_000,
  artworkUrl: "https://youtube/cover",
  explicit: false,
};

test("the first matching Songs result wins over unrelated titles and artists and keeps YouTube's cover", () => {
  assert.deepEqual(
    resolveRecognizedSong(heard, [], {
      ok: true,
      songs: [
        { ...onlineSong, videoId: "wrong-title", title: "Other song" },
        { ...onlineSong, videoId: "wrong-artist", artists: ["Other singer"] },
        onlineSong,
        { ...onlineSong, videoId: "later" },
      ],
    }),
    { kind: "resolved", lookup: "match", result: { kind: "stream", song: onlineSong } },
  );
});

test("a completed search without a matching recording keeps an unavailable entry with Shazam's metadata", () => {
  assert.deepEqual(
    resolveRecognizedSong(heard, [], { ok: true, songs: [{ ...onlineSong, title: "Wrong" }] }),
    {
      kind: "resolved",
      lookup: "notFound",
      result: {
        kind: "unavailable",
        song: {
          title: heard.title,
          artists: ["Beyonce", "Guest"],
          album: "Heard album",
          durationMs: null,
          artworkUrl: "https://shazam/cover",
          reason: "notFound",
        },
      },
    },
  );
});

test("failed and disabled searches keep unsearched entries for the background fill", () => {
  for (const [answer, lookup] of [
    [{ ok: false, reason: "failed" }, "failed"],
    ["disabled", "disabled"],
  ] as const) {
    assert.deepEqual(resolveRecognizedSong(heard, [], answer), {
      kind: "resolved",
      lookup,
      result: {
        kind: "unsearched",
        song: {
          title: heard.title,
          artists: ["Beyonce", "Guest"],
          album: "Heard album",
          durationMs: null,
          artworkUrl: "https://shazam/cover",
        },
      },
    });
    const own = resolveRecognizedSong(heard, [track], answer);
    assert.equal(own.kind, "resolved");
    if (own.kind === "resolved") assert.equal(own.result.kind, "library");
  }
});

const resolved = (
  answer?: Parameters<typeof resolveRecognizedSong>[2],
  library = [] as (typeof track)[],
) => {
  const resolution = resolveRecognizedSong(heard, library, answer);
  assert.equal(resolution.kind, "resolved");
  if (resolution.kind !== "resolved") throw new Error("Expected a result");
  return resolution.result;
};

test("each result offers its useful actions and Listen Again, with online actions following the YT Music switch", () => {
  const library = resolved(undefined, [track]);
  const stream = resolved({ ok: true, songs: [onlineSong] });
  const unavailable = resolved({ ok: true, songs: [] });
  const unsearched = resolved("disabled");
  for (const ytMusic of [true, false]) {
    assert.deepEqual(recognizeResultActions(library, { ytMusic }), [
      "play",
      "playNext",
      "addToShazam",
      "addToPlaylist",
      "goToAlbum",
      "listenAgain",
    ]);
    assert.deepEqual(
      recognizeResultActions(stream, { ytMusic }),
      ytMusic
        ? ["play", "playNext", "addToShazam", "addToPlaylist", "download", "listenAgain"]
        : ["addToShazam", "addToPlaylist", "listenAgain"],
    );
    for (const result of [unavailable, unsearched]) {
      assert.deepEqual(recognizeResultActions(result, { ytMusic }), [
        "addToShazam",
        "addToPlaylist",
        "listenAgain",
      ]);
    }
  }
});

test("recognized downloads offer cancel or retry from the existing queue status and hide actions while saving", () => {
  const result = resolved({ ok: true, songs: [onlineSong] });
  for (const [status, action] of [
    [{ kind: "queued" }, "cancelDownload"],
    [{ kind: "downloading", received: 50, total: 100 }, "cancelDownload"],
    [{ kind: "failed", reason: "failed" }, "retryDownload"],
    [{ kind: "done", path: "/music/song.mp3" }, "download"],
    [{ kind: "saving" }, null],
  ] as const) {
    assert.deepEqual(recognizeResultActions(result, { ytMusic: true, status }), [
      "play",
      "playNext",
      "addToShazam",
      "addToPlaylist",
      ...(action === null ? [] : [action]),
      "listenAgain",
    ]);
  }
});

test("each recognized kind saves as its existing playlist entry and round-trips without new columns", () => {
  const cases = [
    [resolved(undefined, [track]), { source: "library", trackId: 42 }],
    [resolved({ ok: true, songs: [onlineSong] }), { source: "stream", song: onlineSong }],
    [
      resolved({ ok: true, songs: [] }),
      {
        source: "unavailable",
        song: {
          title: heard.title,
          artists: ["Beyonce", "Guest"],
          album: "Heard album",
          durationMs: null,
          artworkUrl: "https://shazam/cover",
          reason: "notFound",
        },
      },
    ],
    [
      resolved("disabled"),
      {
        source: "unsearched",
        song: {
          title: heard.title,
          artists: ["Beyonce", "Guest"],
          album: "Heard album",
          durationMs: null,
          artworkUrl: "https://shazam/cover",
        },
      },
    ],
  ] as const;
  for (const [result, expected] of cases) {
    const entry = recognizePlaylistSong(result);
    assert.deepEqual(entry, expected);
    if (entry.source !== "library") {
      const saved = readPlaylistEntrySong(writePlaylistEntrySong(entry));
      assert.deepEqual(
        saved,
        entry.source === "stream" ? { ...entry, song: { ...entry.song, albumId: null } } : entry,
      );
    }
  }
});

test("the result card shows the resolved song without a source label and every result's actions", () => {
  const result = resolved({ ok: true, songs: [onlineSong] });
  assert.deepEqual(recognizeCardView({ kind: "resolved", result }), {
    title: "DÉJÀ VU",
    lines: ["Beyoncé", "Online album"],
    cover: true,
    coverUrl: "https://youtube/cover",
    listening: false,
    actions: ["play", "playNext", "addToShazam", "addToPlaylist", "download", "listenAgain"],
  });
  assert.equal(RECOGNIZE_CARD_ACTION_LABELS.listenAgain, "Listen Again");
});

test("a recognition log includes the lookup outcome without song metadata", () => {
  assert.equal(
    recognizeLogLine({
      source: "microphone",
      heardMs: 4000,
      outcome: { kind: "match", song: heard },
      lookup: "notFound",
    }),
    "Recognize through the microphone: a match after 4.0 s, YT Music lookup: notFound",
  );
});

test("the Library result displays the Track's written credit", () => {
  const result = resolved(undefined, [{ ...track, artist: "Beyoncé feat. Guest" }]);
  assert.deepEqual(recognizeCardView({ kind: "resolved", result }).lines, [
    "Beyoncé feat. Guest",
    "Library album",
  ]);
});

test("a finished download stops offering Download once its song is in the Library", () => {
  const result = resolved({ ok: true, songs: [onlineSong] });
  assert.deepEqual(
    recognizeResultActions(result, {
      ytMusic: true,
      status: { kind: "done", path: "/music/song.m4a" },
      inLibrary: true,
    }),
    ["play", "playNext", "addToShazam", "addToPlaylist", "listenAgain"],
  );
});
