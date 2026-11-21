import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { libraryArtistFinder, similarArtistLinks } from "./index.ts";
import type { YtArtistCandidate } from "./index.ts";

const similar = (name: string, browseId: string): YtArtistCandidate => ({
  name,
  browseId,
  audience: null,
});

const LIBRARY = [
  { id: 1, name: "Justice" },
  { id: 2, name: "Unknown Artist" },
];

describe("which page a similar artist opens", () => {
  test("an artist the Library has opens the Library's page, the others the online page", () => {
    const links = similarArtistLinks(
      [similar("JUSTICE", "UCjustice"), similar("Air", "UCair")],
      libraryArtistFinder(LIBRARY),
    );
    assert.deepEqual(links, [
      { artist: similar("JUSTICE", "UCjustice"), library: { id: 1, name: "Justice" } },
      { artist: similar("Air", "UCair"), library: null },
    ]);
  });

  test("a name that isn't an artist's is nobody in the Library", () => {
    const [link] = similarArtistLinks(
      [similar("Unknown Artist", "UCunknown")],
      libraryArtistFinder(LIBRARY),
    );
    assert.equal(link?.library, null);
  });

  test("until the Library's artists have answered, no tile shows", () => {
    assert.deepEqual(similarArtistLinks([similar("Air", "UCair")], null), []);
  });
});
