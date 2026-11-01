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

  it("says No match when a session ends without one, and offers Try Again", () => {
    assert.deepEqual(recognizeTileNotice({ kind: "ended", end: { kind: "noMatch" } }), {
      kind: "failure",
      title: "No match",
      text: "Wave couldn't name this song. Try listening again.",
      action: "tryAgain",
      actionLabel: "Try Again",
    });
  });

  it("says when there's no connection, and offers Try Again", () => {
    assert.deepEqual(recognizeTileNotice({ kind: "offline" }), {
      kind: "failure",
      title: "No connection",
      text: "Connect to the internet to recognize a song.",
      action: "tryAgain",
      actionLabel: "Try Again",
    });
  });

  for (const [failure, text] of [
    ["network", "The connection dropped before an answer came."],
    ["capture", "The audio capture stopped sending sound."],
    ["refused", "The recognition service turned the request down. Try again in a minute."],
    ["unreadable", "The recognition service sent an answer Wave can't read."],
  ] as const) {
    it(`gives the card's reason for a ${failure} failure, and offers Try Again`, () => {
      assert.deepEqual(
        recognizeTileNotice({
          kind: "ended",
          end: { kind: "failed", failure, status: null },
        }),
        {
          kind: "failure",
          title: "Couldn't recognize the song",
          text,
          action: "tryAgain",
          actionLabel: "Try Again",
        },
      );
    });
  }

  it("offers Use Microphone when the playing app blocks capture", () => {
    assert.deepEqual(recognizeTileNotice({ kind: "ended", end: { kind: "blocked" } }), {
      kind: "failure",
      title: "This app blocks audio capture",
      text: "Try the microphone to recognize music around you.",
      action: "useMicrophone",
      actionLabel: "Use Microphone",
    });
  });

  it("offers Try Again without the microphone: a tap then opens the card, which can ask", () => {
    assert.deepEqual(recognizeTileNotice({ kind: "denied" }), {
      kind: "failure",
      title: "Microphone access is off",
      text: "Allow Wave to capture audio in its Android settings to recognize songs.",
      action: "tryAgain",
      actionLabel: "Try Again",
    });
  });

  it("posts nothing when phone audio is declined, which ends like Cancel", () => {
    assert.equal(recognizeTileNotice({ kind: "ended", end: { kind: "consentDeclined" } }), null);
  });

  it("speaks the app's language", () => {
    const pt = catalogueOf("pt-BR");
    const noMatch = recognizeTileNotice({ kind: "ended", end: { kind: "noMatch" } }, pt);
    assert.equal(noMatch?.title, "Nenhum resultado");
    assert.equal(noMatch?.kind === "failure" && noMatch.actionLabel, "Tentar Novamente");
    const blocked = recognizeTileNotice({ kind: "ended", end: { kind: "blocked" } }, pt);
    assert.equal(blocked?.kind === "failure" && blocked.actionLabel, "Usar Microfone");
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

// Notification actions have their own catalogue entries, so callers can localize them.
it("uses the tile action labels from the supplied catalogue", () => {
  const catalogue = {
    ...catalogueOf("en"),
    recognizeTile: { tryAgain: "Retry capture", useMicrophone: "Listen nearby" },
  };
  const retry = recognizeTileNotice({ kind: "offline" }, catalogue);
  assert.equal(retry?.kind === "failure" && retry.actionLabel, "Retry capture");
  const microphone = recognizeTileNotice({ kind: "ended", end: { kind: "blocked" } }, catalogue);
  assert.equal(microphone?.kind === "failure" && microphone.actionLabel, "Listen nearby");
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
