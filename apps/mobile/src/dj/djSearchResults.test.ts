import assert from "node:assert/strict";
import { test } from "node:test";

import { djSearchResults } from "./djSearchResults.ts";

const artist = (id: number, name: string) => ({
  id,
  name,
  thumbPath: `/thumbs/${id}.jpg`,
  artworkPath: null,
});

test("the Library's artists and albums come first, then the ones YouTube Music adds", () => {
  const results = djSearchResults(
    {
      artists: [artist(4, "Burial")],
      albums: [
        {
          id: 9,
          title: "Untrue",
          albumArtist: "Burial",
          artworkPath: "/art/9.jpg",
          thumbPath: "/thumbs/a9.jpg",
        },
      ],
    },
    {
      artists: [
        { name: "Burial", browseId: "UCburial", audience: null, artworkUrl: "https://yt/b.jpg" },
        { name: "Burial Hex", browseId: "UChex", audience: null, artworkUrl: "https://yt/h.jpg" },
      ],
      albums: [
        {
          kind: "album",
          browseId: "MPREb_kindred",
          title: "Kindred",
          artists: ["Burial", "Four Tet"],
          year: 2012,
          artworkUrl: "https://yt/k.jpg",
        },
      ],
    },
  );
  assert.deepEqual(
    results.map(({ tile }) => [tile.kind, tile.name, tile.libraryId]),
    [
      ["artist", "Burial", 4],
      ["artist", "Burial Hex", null],
      ["album", "Untrue", 9],
      ["album", "Kindred", null],
    ],
  );
  // An artist row draws the Library's image, or YouTube Music's picture.
  assert.deepEqual(
    results.map(({ image }) => image?.thumbPath ?? image?.imageUrl ?? null),
    ["/thumbs/4.jpg", "https://yt/h.jpg", null, null],
  );
  // An album tile carries its cover, its album artist and where its songs are read.
  const [, , untrue, kindred] = results.map(({ tile }) => tile);
  assert.deepEqual(untrue?.kind === "album" && [untrue.artist, untrue.cover], [
    "Burial",
    "/art/9.jpg",
  ]);
  assert.deepEqual(kindred?.kind === "album" && [kindred.artist, kindred.cover, kindred.browseId], [
    "Burial",
    "https://yt/k.jpg",
    "MPREb_kindred",
  ]);
});
