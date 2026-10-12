import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { artistArtwork, artistInitial } from "./index.ts";
import type { ArtistAlbumLink } from "./index.ts";

/** An album linked to artist 1, with defaults a test overrides. */
const link = (overrides: Partial<ArtistAlbumLink> & { albumId: number }): ArtistAlbumLink => ({
  artistId: 1,
  own: true,
  songs: 10,
  year: null,
  titleSort: `album ${overrides.albumId}`,
  artwork: `cover-${overrides.albumId}`,
  ...overrides,
});

const imageOf = (links: readonly ArtistAlbumLink[], artistId = 1) =>
  artistArtwork(links).get(artistId);

describe("artistArtwork", () => {
  test("an artist's image is the cover of their own album with the most songs", () => {
    assert.equal(
      imageOf([
        link({ albumId: 1, songs: 9 }),
        link({ albumId: 2, songs: 14 }),
        link({ albumId: 3, songs: 11 }),
      ]),
      "cover-2",
    );
  });

  test("an own album wins over a bigger album they only appear on", () => {
    assert.equal(
      imageOf([link({ albumId: 1, songs: 3 }), link({ albumId: 2, own: false, songs: 6 })]),
      "cover-1",
    );
  });

  test("with no album of their own, it's the album they appear on most", () => {
    assert.equal(
      imageOf([
        link({ albumId: 1, own: false, songs: 1 }),
        link({ albumId: 2, own: false, songs: 4 }),
        link({ albumId: 3, own: false, songs: 2 }),
      ]),
      "cover-2",
    );
  });

  describe("ties on songs go to the album listed first on the artist page, whatever the order", () => {
    const both = (a: ArtistAlbumLink, b: ArtistAlbumLink) => [imageOf([a, b]), imageOf([b, a])];

    test("the newest album", () => {
      assert.deepEqual(both(link({ albumId: 1, year: 1997 }), link({ albumId: 2, year: 2000 })), [
        "cover-2",
        "cover-2",
      ]);
    });

    test("a dated album before an undated one", () => {
      assert.deepEqual(both(link({ albumId: 1 }), link({ albumId: 2, year: 1971 })), [
        "cover-2",
        "cover-2",
      ]);
    });

    test("then by title", () => {
      assert.deepEqual(
        both(link({ albumId: 1, titleSort: "kid a" }), link({ albumId: 2, titleSort: "amnesiac" })),
        ["cover-2", "cover-2"],
      );
    });

    test("then the album indexed first", () => {
      assert.deepEqual(
        both(link({ albumId: 7, titleSort: "same" }), link({ albumId: 3, titleSort: "same" })),
        ["cover-3", "cover-3"],
      );
    });
  });

  describe("no artwork", () => {
    test("an album without a cover gives way to the next one that has one", () => {
      assert.equal(
        imageOf([link({ albumId: 1, songs: 20, artwork: null }), link({ albumId: 2, songs: 5 })]),
        "cover-2",
      );
    });

    test("own albums without covers give way to an album they appear on", () => {
      assert.equal(
        imageOf([link({ albumId: 1, artwork: null }), link({ albumId: 2, own: false, songs: 1 })]),
        "cover-2",
      );
    });

    test("an artist with no cover anywhere has no image (the placeholder shows)", () => {
      const images = artistArtwork([
        link({ albumId: 1, artwork: null }),
        link({ albumId: 2, own: false, artwork: null }),
      ]);
      assert.equal(images.has(1), false);
    });
  });

  describe("compilations", () => {
    // "Pixies" (2) has a song on a Various Artists compilation (3), filed under Various Artists.
    const compilation = 30;
    const links = [
      link({ artistId: 3, albumId: compilation, songs: 18 }),
      link({ artistId: 3, albumId: 31, songs: 12 }),
      link({ artistId: 2, albumId: compilation, own: false, songs: 1 }),
    ];

    test("an artist only on compilations takes the compilation's cover", () => {
      assert.equal(imageOf(links, 2), "cover-30");
    });

    test("Various Artists takes its biggest compilation's cover", () => {
      assert.equal(imageOf(links, 3), "cover-30");
    });

    test("an artist with an album of their own doesn't take a compilation's cover", () => {
      assert.equal(
        imageOf([...links, link({ artistId: 2, albumId: 40, songs: 1 })], 2),
        "cover-40",
      );
    });
  });
});

describe("artistInitial", () => {
  test("is the first letter of the name, upper-cased, as the A–Z spine files it", () => {
    assert.equal(artistInitial("radiohead"), "R");
    assert.equal(artistInitial("The Beatles"), "B");
    assert.equal(artistInitial("a-ha"), "A");
    assert.equal(artistInitial("...And You Will Know Us"), "A");
  });

  test("keeps accents, digits and non-Latin letters", () => {
    assert.equal(artistInitial("Émilie Simon"), "É");
    assert.equal(artistInitial("50 Cent"), "5");
    assert.equal(artistInitial("Кино"), "К");
  });

  test("a name with no letter or digit has none", () => {
    assert.equal(artistInitial("!!!"), "");
    assert.equal(artistInitial(""), "");
  });
});
