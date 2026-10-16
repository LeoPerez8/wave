import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { libraryArtistFinder, streamedArtistLink, type StreamedArtistContext } from "./index.ts";

const LIBRARY = [
  { id: 1, name: "Beatles" },
  { id: 2, name: "Björk" },
  { id: 3, name: "Daft Punk" },
];

type Artist = (typeof LIBRARY)[number];

const context = (rest: Partial<StreamedArtistContext<Artist>> = {}) => ({
  libraryArtist: libraryArtistFinder(LIBRARY),
  enabled: true,
  here: "/library/songs",
  ...rest,
});

describe("streamedArtistLink", () => {
  test("an artist the Library has opens their Library page", () => {
    assert.deepEqual(streamedArtistLink(["The Beatles"], context()), {
      kind: "open",
      target: { kind: "library", artist: LIBRARY[0] },
    });
  });

  test("any other artist opens the YouTube Music artist page, by their name", () => {
    assert.deepEqual(streamedArtistLink(["Justice"], context()), {
      kind: "open",
      target: { kind: "yt", name: "Justice" },
    });
  });

  test("a song credited to several artists offers the choice, in credit order", () => {
    assert.deepEqual(streamedArtistLink(["Justice", "Daft Punk", "Bjork"], context()), {
      kind: "choose",
      targets: [
        { kind: "yt", name: "Justice" },
        { kind: "library", artist: LIBRARY[2] },
        { kind: "library", artist: LIBRARY[1] },
      ],
    });
  });

  test("a name credited twice is one artist, and a choice of one opens straight away", () => {
    assert.deepEqual(streamedArtistLink(["The Beatles", "Beatles"], context()), {
      kind: "open",
      target: { kind: "library", artist: LIBRARY[0] },
    });
    assert.deepEqual(streamedArtistLink(["Justice", "justice"], context()), {
      kind: "open",
      target: { kind: "yt", name: "Justice" },
    });
  });

  test("names that aren't an artist's lead nowhere", () => {
    assert.deepEqual(streamedArtistLink(["Various Artists", "Justice"], context()), {
      kind: "open",
      target: { kind: "yt", name: "Justice" },
    });
    assert.equal(streamedArtistLink(["Unknown Artist"], context()), undefined);
    assert.equal(streamedArtistLink([], context()), undefined);
  });

  test("only the page you're on left is the page you're on; nobody left is no link", () => {
    const onBeatles = context({ here: "/library/artist/1" });
    assert.deepEqual(streamedArtistLink(["Beatles", "The Beatles"], onBeatles), { kind: "here" });
    assert.equal(streamedArtistLink(["Unknown Artist"], onBeatles), undefined);
    assert.equal(streamedArtistLink(["Beatles"], { ...onBeatles, enabled: false }), undefined);
  });

  test("with YT Music off there is no link", () => {
    assert.equal(streamedArtistLink(["The Beatles"], context({ enabled: false })), undefined);
    assert.equal(streamedArtistLink(["Justice"], context({ enabled: false })), undefined);
  });

  test("the Library artist page you're on is left out", () => {
    const onBeatles = context({ here: "/library/artist/1" });
    assert.deepEqual(streamedArtistLink(["Beatles"], onBeatles), { kind: "here" });
    assert.deepEqual(streamedArtistLink(["Beatles", "Justice"], onBeatles), {
      kind: "open",
      target: { kind: "yt", name: "Justice" },
    });
    assert.deepEqual(streamedArtistLink(["Beatles"], context({ here: "/playlists/artist/2" })), {
      kind: "open",
      target: { kind: "library", artist: LIBRARY[0] },
    });
  });

  test("the YouTube Music artist page you're on is left out", () => {
    const onJustice = context({ here: "/library/yt-artist/by-name", ytArtistHere: "Justice" });
    assert.deepEqual(streamedArtistLink(["justice"], onJustice), { kind: "here" });
    assert.deepEqual(streamedArtistLink(["Justice", "Daft Punk"], onJustice), {
      kind: "open",
      target: { kind: "library", artist: LIBRARY[2] },
    });
    assert.deepEqual(streamedArtistLink(["Justice"], context({ ytArtistHere: "Busy P" })), {
      kind: "open",
      target: { kind: "yt", name: "Justice" },
    });
  });
});
