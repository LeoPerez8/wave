import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NO_SIMILAR_ARTISTS_KEPT,
  parseSimilarArtistsKept,
  similarArtistsKeptOf,
  storedSimilarArtistsKept,
  withSimilarArtistsKept,
} from "./index.ts";

const similar = (name: string) => ({ name, browseId: `UC-${name}` });

describe("The similar artists the harvest read, kept for offline builds", () => {
  test("are found by the Library artist's name, case aside; unknown for one never read", () => {
    const kept = withSimilarArtistsKept(NO_SIMILAR_ARTISTS_KEPT, "Sleep Token", [
      similar("Bad Omens"),
    ]);
    assert.deepEqual(similarArtistsKeptOf(kept, "sleep token"), [similar("Bad Omens")]);
    assert.equal(similarArtistsKeptOf(kept, "Spiritbox"), undefined);
    // A page that lists no one is kept too: the build needn't wait for it.
    assert.deepEqual(similarArtistsKeptOf(withSimilarArtistsKept(kept, "Spiritbox", []), "Spiritbox"), []);
  });

  test("keep the latest 100 artists read, and survive being saved", () => {
    let kept = NO_SIMILAR_ARTISTS_KEPT;
    for (let n = 0; n < 101; n++) kept = withSimilarArtistsKept(kept, `Artist ${n}`, [similar(`S${n}`)]);
    assert.equal(similarArtistsKeptOf(kept, "Artist 0"), undefined);
    assert.deepEqual(similarArtistsKeptOf(kept, "Artist 100"), [similar("S100")]);
    const saved = parseSimilarArtistsKept(storedSimilarArtistsKept(kept));
    assert.deepEqual(similarArtistsKeptOf(saved, "Artist 1"), [similar("S1")]);
    assert.equal(parseSimilarArtistsKept("{}").size, 0);
    assert.equal(parseSimilarArtistsKept(null).size, 0);
  });
});
