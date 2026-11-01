import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { catalogueOf, recognizeTileNotice, type RecognizedSong } from "./index.ts";

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
