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

  it("says No match when a session ends without one", () => {
    assert.deepEqual(recognizeTileNotice({ kind: "ended", end: { kind: "noMatch" } }), {
      kind: "noMatch",
      title: "No match",
      text: "Wave couldn't name this song. Try listening again.",
      coverUrl: null,
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
