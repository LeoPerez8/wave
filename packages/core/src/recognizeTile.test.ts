import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  catalogueOf,
  readRecognizeMatch,
  recognizeMatchResult,
  recognizeTileNotice,
  resolveRecognizedSong,
  writeRecognizeMatch,
  type RecognizedSong,
  type RecognizeResolution,
  type YtSong,
} from "./index.ts";

const song: RecognizedSong = {
  title: "Ain't It Fun",
  artist: "Paramore",
  album: "Paramore",
  coverUrl: "https://example.com/cover.jpg",
  isrc: null,
  releaseYear: null,
};

describe("What a tile session tells the user", () => {
  it("names the match with its title, artist and cover as soon as Shazam answers", () => {
    assert.deepEqual(recognizeTileNotice({ kind: "resolving", song }), {
      kind: "match",
      title: "Ain't It Fun",
      text: "Paramore",
      coverUrl: "https://example.com/cover.jpg",
      match: writeRecognizeMatch(song),
    });
  });

  it("says No match when a session ends without one", () => {
    assert.deepEqual(recognizeTileNotice({ kind: "ended", end: { kind: "noMatch" } }), {
      kind: "noMatch",
      title: "No match",
      text: "Wave couldn't name this song. Try listening again.",
      coverUrl: null,
      match: null,
    });
  });

  it("speaks the app's language", () => {
    const notice = recognizeTileNotice(
      { kind: "ended", end: { kind: "noMatch" } },
      catalogueOf("pt-BR"),
    );
    assert.equal(notice?.title, "Nenhum resultado");
  });

  it("posts nothing while listening or once the song is settled", () => {
    assert.equal(recognizeTileNotice({ kind: "listening" }), null);
    assert.equal(
      recognizeTileNotice({
        kind: "resolved",
        result: {
          kind: "unsearched",
          song: {
            title: "Ain't It Fun",
            artists: ["Paramore"],
            album: null,
            durationMs: null,
            artworkUrl: null,
          },
        },
      }),
      null,
    );
  });
});

const track = {
  id: 7,
  title: "Ain't It Fun",
  artist: "Paramore",
  album: "Paramore",
  durationMs: 296_000,
};

const stream: YtSong = {
  videoId: "abc",
  title: "Ain't It Fun",
  artists: ["Paramore"],
  album: "Paramore",
  durationMs: 296_000,
  artworkUrl: "https://example.com/yt.jpg",
  explicit: false,
};

const unsearched = (resolveRecognizedSong(song, [], "disabled") as RecognizeResolution).result;

/** The match as a tap on its notification finds it, in another run of Wave. */
const kept = (...args: Parameters<typeof writeRecognizeMatch>) => {
  const match = readRecognizeMatch(writeRecognizeMatch(...args));
  assert.notEqual(match, null);
  return match!;
};

describe("The match a tile's notification keeps", () => {
  it("brings back a settled song as it was, with no search", () => {
    assert.deepEqual(recognizeMatchResult(kept(song, { kind: "stream", song: stream }), []), {
      kind: "stream",
      song: stream,
    });
    assert.deepEqual(recognizeMatchResult(kept(song, unsearched), []), unsearched);
  });

  it("names a Library song by its id, and shows the Library's row as it is now", () => {
    const resolved = (resolveRecognizedSong(song, [track]) as RecognizeResolution).result;
    const match = kept(song, resolved);
    assert.equal(match.result?.kind === "library" ? match.result.trackId : null, 7);
    const retagged = { ...track, album: "Paramore (Deluxe)" };
    const shown = recognizeMatchResult(match, [retagged]);
    assert.equal(shown.kind, "library");
    assert.equal(shown.kind === "library" ? shown.track : null, retagged);
  });

  it("falls back to an unsearched entry when its Library song has gone", () => {
    const resolved = (resolveRecognizedSong(song, [track]) as RecognizeResolution).result;
    assert.deepEqual(recognizeMatchResult(kept(song, resolved), []), unsearched);
  });

  it("settles a song whose lookup never ended from the Library alone, with no search", () => {
    assert.equal(recognizeMatchResult(kept(song), [track]).kind, "library");
    assert.deepEqual(recognizeMatchResult(kept(song), []), unsearched);
  });

  it("keeps no more than the song and what it resolved to", () => {
    assert.deepEqual(Object.keys(kept(song)).sort(), ["result", "song"]);
  });

  it("reads nothing from text that isn't a kept match", () => {
    for (const text of ["", "null", "{}", '{"song":{"title":1}}', "not json"])
      assert.equal(readRecognizeMatch(text), null);
    assert.equal(
      readRecognizeMatch(JSON.stringify({ song, result: { kind: "somethingNew", song: stream } })),
      null,
    );
  });
});

it("rejects malformed kept results before they reach result actions", () => {
  for (const result of [
    { kind: "stream" },
    { kind: "library", trackId: "7", song: {} },
    { kind: "unsearched", song: { title: "broken" } },
  ]) {
    assert.equal(readRecognizeMatch(JSON.stringify({ song, result })), null);
  }
});
