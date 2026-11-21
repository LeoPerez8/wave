import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NO_ARTIST_PAGE_LOOKUP_FAILURES,
  artistPageItems,
  artistPageKept,
  artistPageLookupDue,
  artistPageLookupFailedAt,
  artistPageLookupLine,
  artistPageLookupReads,
  parseArtistPageLookupFailures,
  storedArtistPageLookupFailures,
  withArtistPageLookupEnded,
  type YtArtistPage,
  type YtArtistSaved,
} from "./index.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

const BAD_OMENS = { name: "Bad Omens", browseId: "UC-bad-omens", audience: null };

const page = (extra: Partial<YtArtistPage> = {}): YtArtistPage => ({
  name: "Sleep Token",
  songs: [],
  albums: [],
  singles: [],
  similar: [BAD_OMENS],
  description: "A masked collective.",
  subscribers: "2.1M",
  views: "900,000,000",
  ...extra,
});

const found = (age: number, extra: Partial<YtArtistPage> = {}): YtArtistSaved => ({
  outcome: "found",
  checkedAt: NOW - age,
  browseId: "UC-sleep-token",
  page: page(extra),
});

const unmatched = (age: number): YtArtistSaved => ({ outcome: "unmatched", checkedAt: NOW - age });

const open = {
  name: "Sleep Token",
  enabled: true,
  online: true,
  settled: true,
  contentReady: true,
  failedAt: undefined,
  now: NOW,
};

describe("A Library artist's YouTube Music page lookup", () => {
  test("is due for an artist never looked up", () => {
    assert.equal(artistPageLookupDue({ ...open, saved: null }), true);
  });

  test("waits for the page's own content and the settled screen, and never runs offline or with YT Music off", () => {
    assert.equal(artistPageLookupDue({ ...open, saved: null, contentReady: false }), false);
    assert.equal(artistPageLookupDue({ ...open, saved: null, settled: false }), false);
    assert.equal(artistPageLookupDue({ ...open, saved: null, online: false }), false);
    assert.equal(artistPageLookupDue({ ...open, saved: null, enabled: false }), false);
  });

  test("never runs for a name that isn't an artist's", () => {
    assert.equal(artistPageLookupDue({ ...open, saved: null, name: "Various Artists" }), false);
    assert.equal(artistPageLookupDue({ ...open, saved: null, name: "Unknown Artist" }), false);
    assert.equal(artistPageLookupDue({ ...open, saved: null, name: "???" }), false);
  });

  test("opening the artist again makes no lookup until the kept page is 30 days old", () => {
    assert.equal(artistPageLookupDue({ ...open, saved: found(0) }), false);
    assert.equal(artistPageLookupDue({ ...open, saved: found(8 * DAY) }), false);
    assert.equal(artistPageLookupDue({ ...open, saved: found(30 * DAY - 1) }), false);
    assert.equal(artistPageLookupDue({ ...open, saved: found(30 * DAY) }), true);
  });

  test("a kept page with no description or no similar artists is still kept for 30 days", () => {
    const bare = found(DAY, { description: null, subscribers: null, views: null, similar: [] });
    assert.equal(artistPageLookupDue({ ...open, saved: bare }), false);
  });

  test("a page saved before Wave read the About is read again", () => {
    const before: { description?: string | null } & YtArtistPage = page();
    delete before.description;
    const saved: YtArtistSaved = {
      outcome: "found",
      checkedAt: NOW - DAY,
      browseId: "UC-sleep-token",
      page: before,
    };
    assert.equal(artistPageLookupDue({ ...open, saved }), true);
  });

  test("no match is tried again after a week", () => {
    assert.equal(artistPageLookupDue({ ...open, saved: unmatched(DAY) }), false);
    assert.equal(artistPageLookupDue({ ...open, saved: unmatched(7 * DAY - 1) }), false);
    assert.equal(artistPageLookupDue({ ...open, saved: unmatched(7 * DAY) }), true);
  });

  test("a lookup that got no answer is tried again after a day", () => {
    const failed = (ago: number) => ({ ...open, saved: null, failedAt: NOW - ago });
    assert.equal(artistPageLookupDue(failed(HOUR)), false);
    assert.equal(artistPageLookupDue(failed(DAY - 1)), false);
    assert.equal(artistPageLookupDue(failed(DAY)), true);
    // An old page whose refresh failed an hour ago waits the day too.
    assert.equal(
      artistPageLookupDue({ ...open, saved: found(40 * DAY), failedAt: NOW - HOUR }),
      false,
    );
    assert.equal(
      artistPageLookupDue({ ...open, saved: found(40 * DAY), failedAt: NOW - 2 * DAY }),
      true,
    );
  });

  test("a clock set back waits rather than asking again", () => {
    assert.equal(artistPageLookupDue({ ...open, saved: found(-DAY) }), false);
    assert.equal(artistPageLookupDue({ ...open, saved: unmatched(-DAY) }), false);
    assert.equal(artistPageLookupDue({ ...open, saved: null, failedAt: NOW + HOUR }), false);
  });

  test("reads the page alone, or whole again when the kept page holds every song of the artist", () => {
    assert.deepEqual(artistPageLookupReads(null), { allSongs: false });
    assert.deepEqual(artistPageLookupReads(unmatched(8 * DAY)), { allSongs: false });
    assert.deepEqual(artistPageLookupReads(found(40 * DAY)), { allSongs: false });
    assert.deepEqual(artistPageLookupReads(found(40 * DAY, { allSongs: [] })), {
      allSongs: true,
    });
  });

  test("says in the app log how it ended", () => {
    assert.equal(
      artistPageLookupLine("Sleep Token", "found"),
      'The YouTube Music page lookup for the Library artist "Sleep Token" found their page',
    );
    assert.equal(
      artistPageLookupLine("Sleep Token", "unmatched"),
      'The YouTube Music page lookup for the Library artist "Sleep Token" found no match',
    );
    assert.equal(
      artistPageLookupLine("Sleep Token", "offline"),
      'The YouTube Music page lookup for the Library artist "Sleep Token" failed (offline)',
    );
  });
});

describe("Lookups that got no answer", () => {
  test("are remembered by the artist's name, case aside, and forgotten once one answers", () => {
    let failures = withArtistPageLookupEnded(
      NO_ARTIST_PAGE_LOOKUP_FAILURES,
      "Sleep Token",
      "failed",
      NOW,
    );
    assert.equal(artistPageLookupFailedAt(failures, "sleep token"), NOW);
    assert.equal(artistPageLookupFailedAt(failures, "Spiritbox"), undefined);
    failures = withArtistPageLookupEnded(failures, "Sleep Token", null, NOW + HOUR);
    assert.equal(artistPageLookupFailedAt(failures, "Sleep Token"), undefined);
  });

  test("a request that couldn't be sent isn't one: it's tried with the network back", () => {
    const none = NO_ARTIST_PAGE_LOOKUP_FAILURES;
    assert.equal(withArtistPageLookupEnded(none, "Sleep Token", "offline", NOW).size, 0);
    assert.equal(withArtistPageLookupEnded(none, "Sleep Token", "disabled", NOW).size, 0);
  });

  test("keep the latest 200 artists and survive being saved", () => {
    let failures = NO_ARTIST_PAGE_LOOKUP_FAILURES;
    for (let n = 0; n < 201; n++)
      failures = withArtistPageLookupEnded(failures, `Artist ${n}`, "failed", NOW + n);
    assert.equal(artistPageLookupFailedAt(failures, "Artist 0"), undefined);
    const saved = parseArtistPageLookupFailures(storedArtistPageLookupFailures(failures));
    assert.equal(artistPageLookupFailedAt(saved, "Artist 1"), NOW + 1);
    assert.equal(artistPageLookupFailedAt(saved, "Artist 200"), NOW + 200);
    assert.equal(storedArtistPageLookupFailures(NO_ARTIST_PAGE_LOOKUP_FAILURES), null);
    assert.equal(parseArtistPageLookupFailures(null).size, 0);
    assert.equal(parseArtistPageLookupFailures("{}").size, 0);
    assert.equal(
      parseArtistPageLookupFailures('{"version":1,"failures":[["a","soon"],["b",5]]}').get("b"),
      5,
    );
  });
});

describe("What the Library's artist page lists of the kept page", () => {
  /** The page's list: an Albums shelf and two songs, then what's kept for the artist. */
  const listed = (
    saved: YtArtistSaved | null,
    { enabled = true, found: narrowed = null as readonly number[] | null } = {},
  ) => {
    const kept = artistPageKept(saved, enabled);
    return artistPageItems([{ label: "Albums", covers: ["a1"] }], ["t1", "t2"], "Songs", narrowed, {
      similar: { label: "Fans might also like", artists: kept.similar },
      ...(kept.about === null ? {} : { about: kept.about }),
    });
  };

  const OWN = [
    { type: "section", label: "Albums" },
    { type: "shelf", label: "Albums", covers: ["a1"] },
    { type: "section", label: "Songs" },
    { type: "song", song: "t1", index: 0 },
    { type: "song", song: "t2", index: 1 },
  ];
  const SHELF = [
    { type: "section", label: "Fans might also like" },
    { type: "similar", label: "Fans might also like", artists: [BAD_OMENS] },
  ];
  const ABOUT = {
    type: "about",
    about: { description: "A masked collective.", subscribers: "2.1M", views: "900,000,000" },
  };

  test("a kept page: the shelf and the About follow the albums and the songs", () => {
    assert.deepEqual(listed(found(DAY)), [...OWN, ...SHELF, ABOUT]);
  });

  test("a kept page past its 30 days still shows while it's read again", () => {
    assert.deepEqual(listed(found(90 * DAY)), [...OWN, ...SHELF, ABOUT]);
  });

  test("no page kept, or no match: neither part", () => {
    assert.deepEqual(listed(null), OWN);
    assert.deepEqual(listed(unmatched(DAY)), OWN);
  });

  test("each part is left out on its own when the page has none of it", () => {
    assert.deepEqual(listed(found(DAY, { similar: [] })), [...OWN, ABOUT]);
    assert.deepEqual(listed(found(DAY, { description: null })), [...OWN, ...SHELF]);
    assert.deepEqual(listed(found(DAY, { description: "  ", similar: [] })), OWN);
  });

  test("with YT Music off neither part shows", () => {
    assert.deepEqual(listed(found(DAY), { enabled: false }), OWN);
  });

  test("while Find narrows the songs both step aside", () => {
    assert.deepEqual(listed(found(DAY), { found: [1] }), [{ type: "song", song: "t2", index: 1 }]);
  });
});
