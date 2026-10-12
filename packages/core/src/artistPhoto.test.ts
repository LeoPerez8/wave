import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistPhotoLookups,
  artistPhotoName,
  artistPhotoQuery,
  artistPhotosUnreachable,
  deezerArtistCandidates,
  deezerArtistSearchUrl,
  failuresInARow,
  pickArtistPhoto,
} from "./index.ts";
import type { ArtistPhotoCandidate, ArtistPhotoCheck } from "./index.ts";

describe("artistPhotoName", () => {
  test("ignores case, accents, a leading 'The', punctuation and '&' versus 'and'", () => {
    assert.equal(artistPhotoName("The Beatles"), artistPhotoName("beatles"));
    assert.equal(artistPhotoName("Björk"), "bjork");
    assert.equal(artistPhotoName("  Simon &  Garfunkel "), artistPhotoName("Simon and Garfunkel"));
    assert.equal(artistPhotoName("AC/DC"), artistPhotoName("AC-DC"));
    assert.equal(artistPhotoName("Sigur Rós"), "sigur ros");
  });

  test("keeps what tells artists apart", () => {
    assert.notEqual(artistPhotoName("Beatles"), artistPhotoName("Beat les"));
    assert.equal(artistPhotoName("The The"), "the");
    assert.equal(artistPhotoName("坂本龍一"), "坂本龍一");
  });
});

describe("artistPhotoQuery", () => {
  test("is the name to search for, tidied", () => {
    assert.equal(artistPhotoQuery("  Radiohead "), "Radiohead");
    assert.equal(artistPhotoQuery("Simon   & Garfunkel"), "Simon & Garfunkel");
  });

  test("is null for names that aren't an artist (never looked up)", () => {
    for (const name of [
      "Various Artists",
      "various artists",
      "Various",
      "V.A.",
      "VA",
      "Unknown Artist",
      "unknown",
      "<unknown>",
      "",
      "  ",
      "!!!",
    ]) {
      assert.equal(artistPhotoQuery(name), null, name);
    }
  });
});

const picture = (hash: string, size: number) =>
  `https://e-cdns-images.dzcdn.net/images/artist/${hash}/${size}x${size}-000000-80-0-0.jpg`;

/** An artist as Deezer's search returns it. */
const deezerArtist = (name: string, fans: number, hash: string) => ({
  id: fans,
  name,
  link: `https://www.deezer.com/artist/${fans}`,
  picture: `https://api.deezer.com/artist/${fans}/image`,
  picture_small: picture(hash, 56),
  picture_medium: picture(hash, 250),
  picture_big: picture(hash, 500),
  picture_xl: picture(hash, 1000),
  nb_album: 12,
  nb_fan: fans,
  radio: true,
  type: "artist",
});

describe("deezerArtistSearch", () => {
  test("searches Deezer's open API for the name", () => {
    assert.equal(
      deezerArtistSearchUrl("Simon & Garfunkel"),
      "https://api.deezer.com/search/artist?q=Simon%20%26%20Garfunkel&limit=10",
    );
  });

  test("reads each artist's name, fans and photo in a thumbnail and a large size", () => {
    assert.deepEqual(
      deezerArtistCandidates({ data: [deezerArtist("Radiohead", 4_000_000, "9508")], total: 1 }),
      [
        {
          name: "Radiohead",
          fans: 4_000_000,
          thumbUrl: picture("9508", 250),
          largeUrl: picture("9508", 1000),
        },
      ],
    );
  });

  test("an artist with Deezer's blank placeholder has no photo", () => {
    const [candidate] = deezerArtistCandidates({ data: [deezerArtist("Nobody", 3, "")] }) ?? [];
    assert.equal(candidate?.thumbUrl, null);
    assert.equal(candidate?.largeUrl, null);
  });

  test("anything but a search result (an error, a quota message) is null", () => {
    assert.equal(deezerArtistCandidates({ error: { type: "Exception", code: 4 } }), null);
    assert.equal(deezerArtistCandidates(null), null);
    assert.equal(deezerArtistCandidates("<html>"), null);
    assert.deepEqual(deezerArtistCandidates({ data: [], total: 0 }), []);
    assert.deepEqual(deezerArtistCandidates({ data: [{ id: 1 }, 7] }), []);
  });
});

const candidate = (
  name: string,
  fans: number,
  photo: string | null = name,
): ArtistPhotoCandidate => ({
  name,
  fans,
  thumbUrl: photo === null ? null : `${photo}-thumb`,
  largeUrl: photo === null ? null : `${photo}-large`,
});

describe("pickArtistPhoto", () => {
  test("takes the photo of the artist whose name matches", () => {
    assert.deepEqual(
      pickArtistPhoto("Radiohead", [
        candidate("Radiohead Tribute Band", 900),
        candidate("Radiohead", 4_000),
      ]),
      { thumbUrl: "Radiohead-thumb", largeUrl: "Radiohead-large" },
    );
  });

  test("a match ignores case, accents, 'The' and punctuation", () => {
    assert.equal(pickArtistPhoto("Bjork", [candidate("Björk", 10)])?.thumbUrl, "Björk-thumb");
    assert.equal(
      pickArtistPhoto("Beatles", [candidate("The Beatles", 10)])?.thumbUrl,
      "The Beatles-thumb",
    );
    assert.equal(pickArtistPhoto("AC-DC", [candidate("AC/DC", 10)])?.thumbUrl, "AC/DC-thumb");
  });

  test("with no confident match there is no photo", () => {
    assert.equal(pickArtistPhoto("Radiohead", []), null);
    assert.equal(pickArtistPhoto("Radiohead", [candidate("Radiohead Tribute", 9_000)]), null);
    assert.equal(pickArtistPhoto("Mew", [candidate("Mewithoutyou", 9_000)]), null);
    assert.equal(pickArtistPhoto("Various Artists", [candidate("Various Artists", 9_000)]), null);
  });

  test("of namesakes, the most followed is the artist", () => {
    assert.equal(
      pickArtistPhoto("Nirvana", [
        candidate("Nirvana", 30, "60s band"),
        candidate("Nirvana", 9_000_000, "grunge band"),
        candidate("NIRVANA", 12, "other"),
      ])?.thumbUrl,
      "grunge band-thumb",
    );
  });

  test("when the matching artist has no photo, a lesser namesake's isn't taken", () => {
    assert.equal(
      pickArtistPhoto("Nirvana", [candidate("Nirvana", 30), candidate("Nirvana", 9_000, null)]),
      null,
    );
  });

  test("a large photo stands in for a missing thumbnail and the other way round", () => {
    assert.deepEqual(
      pickArtistPhoto("Mew", [{ name: "Mew", fans: 1, thumbUrl: null, largeUrl: "big" }]),
      { thumbUrl: "big", largeUrl: "big" },
    );
    assert.deepEqual(
      pickArtistPhoto("Mew", [{ name: "Mew", fans: 1, thumbUrl: "small", largeUrl: null }]),
      { thumbUrl: "small", largeUrl: "small" },
    );
  });
});

describe("artistPhotoLookups", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 100 * DAY;
  const artists = [
    { key: "radiohead", name: "Radiohead" },
    { key: "various artists", name: "Various Artists" },
    { key: "björk", name: "Björk" },
    { key: "unknown artist", name: "Unknown Artist" },
  ];
  const due = (checks: Record<string, ArtistPhotoCheck>) =>
    artistPhotoLookups(artists, new Map(Object.entries(checks)), now).map((artist) => artist.key);

  test("every artist never looked up is due, except names that aren't an artist", () => {
    assert.deepEqual(due({}), ["radiohead", "björk"]);
    assert.deepEqual(artistPhotoLookups(artists, new Map(), now)[0], {
      key: "radiohead",
      name: "Radiohead",
      query: "Radiohead",
    });
  });

  test("a found photo is never looked up again", () => {
    assert.deepEqual(due({ radiohead: { outcome: "found", checkedAt: 0 } }), ["björk"]);
  });

  test("an artist with no match is retried after a week, not on every launch", () => {
    assert.deepEqual(due({ radiohead: { outcome: "unmatched", checkedAt: now - 6 * DAY } }), [
      "björk",
    ]);
    assert.deepEqual(due({ radiohead: { outcome: "unmatched", checkedAt: now - 7 * DAY } }), [
      "radiohead",
      "björk",
    ]);
  });

  test("a failed lookup (offline, the service down) is retried after a day", () => {
    assert.deepEqual(due({ björk: { outcome: "failed", checkedAt: now - DAY + 1 } }), [
      "radiohead",
    ]);
    assert.deepEqual(due({ björk: { outcome: "failed", checkedAt: now - DAY } }), [
      "radiohead",
      "björk",
    ]);
  });

  test("a check from the future (clock changed) counts as just made", () => {
    assert.deepEqual(due({ björk: { outcome: "failed", checkedAt: now + 30 * DAY } }), [
      "radiohead",
    ]);
  });
});

describe("artistPhotosUnreachable", () => {
  test("three failed lookups in a row mean the service can't be reached", () => {
    let failures = 0;
    for (const outcome of ["failed", "failed"] as const)
      failures = failuresInARow(failures, outcome);
    assert.equal(artistPhotosUnreachable(failures), false);
    failures = failuresInARow(failures, "failed");
    assert.equal(artistPhotosUnreachable(failures), true);
  });

  test("an answer, found or not, starts the count again", () => {
    for (const answer of ["found", "unmatched"] as const) {
      let failures = failuresInARow(failuresInARow(0, "failed"), "failed");
      failures = failuresInARow(failures, answer);
      assert.equal(failures, 0);
      failures = failuresInARow(failuresInARow(failures, "failed"), "failed");
      assert.equal(artistPhotosUnreachable(failures), false);
    }
  });
});
