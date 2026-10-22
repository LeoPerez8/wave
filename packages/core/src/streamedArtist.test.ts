import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  libraryArtistFinder,
  streamedArtistLink,
  resolveStreamedArtistLink,
  type StreamedArtistContext,
} from "./index.ts";

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

test("an unread Library still gives an immediate artist link, without starting a read", () => {
  assert.deepEqual(
    streamedArtistLink(["The Beatles", "Beatles", "Justice"], context({ libraryArtist: null })),
    {
      kind: "choose",
      targets: [
        { kind: "unread", name: "The Beatles" },
        { kind: "unread", name: "Justice" },
      ],
    },
  );
  assert.equal(streamedArtistLink(["Unknown Artist"], context({ libraryArtist: null })), undefined);
  assert.equal(
    streamedArtistLink(["Beatles"], context({ libraryArtist: null, enabled: false })),
    undefined,
  );
});

test("a tap on an unread link prefers the Library, also offline, and filters the current page after reading", async () => {
  const unread = streamedArtistLink(["The Beatles", "Justice"], context({ libraryArtist: null }))!;
  let reads = 0;
  const link = await resolveStreamedArtistLink(unread, context({ libraryArtist: null }), {
    online: false,
    read: async () => {
      reads++;
      return libraryArtistFinder(LIBRARY);
    },
  });
  assert.deepEqual(link, {
    kind: "choose",
    targets: [
      { kind: "library", artist: LIBRARY[0] },
      { kind: "yt", name: "Justice", offline: true },
    ],
  });
  assert.equal(reads, 1);
  assert.deepEqual(
    await resolveStreamedArtistLink(
      unread,
      context({ libraryArtist: null, here: "/library/artist/1" }),
      {
        online: true,
        read: async () => libraryArtistFinder(LIBRARY),
      },
    ),
    { kind: "open", target: { kind: "yt", name: "Justice" } },
  );
});

test("a stalled tap lookup expires at its bound, aborts work, and cannot navigate twice", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const unread = streamedArtistLink(["Justice"], context({ libraryArtist: null }))!;
  let signal: AbortSignal | undefined;
  let finish!: (find: (name: string) => Artist | null) => void;
  let delivered = 0;
  const resolved = resolveStreamedArtistLink(unread, context({ libraryArtist: null }), {
    online: false,
    read: (_, abort) => {
      signal = abort;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  }).then((link) => {
    delivered++;
    return link;
  });
  await Promise.resolve();
  t.mock.timers.tick(499);
  await Promise.resolve();
  assert.equal(delivered, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(await resolved, {
    kind: "open",
    target: { kind: "yt", name: "Justice", offline: true },
  });
  assert.equal(signal?.aborted, true);
  finish(libraryArtistFinder(LIBRARY));
  await Promise.resolve();
  assert.equal(delivered, 1);
});

test("read failure falls back, and an already resolved link does no read", async () => {
  const unread = streamedArtistLink(["Justice"], context({ libraryArtist: null }))!;
  assert.deepEqual(
    await resolveStreamedArtistLink(unread, context(), {
      online: true,
      read: async () => {
        throw new Error("database closed");
      },
    }),
    { kind: "open", target: { kind: "yt", name: "Justice" } },
  );
  const known = streamedArtistLink(["Beatles"], context())!;
  assert.deepEqual(
    await resolveStreamedArtistLink(known, context(), {
      online: false,
      read: async () => {
        assert.fail("already read");
      },
    }),
    known,
  );
});

test("a failed unread credit never replaces an already known Library destination", async () => {
  const mixed = streamedArtistLink(
    ["Beatles", "Justice"],
    context({
      libraryArtist: (name) => (name === "Beatles" ? LIBRARY[0] : undefined),
    }),
  )!;
  let requested: readonly string[] = [];
  const resolved = await resolveStreamedArtistLink(mixed, context({ libraryArtist: null }), {
    online: false,
    read: async (names) => {
      requested = names;
      throw new Error("closed");
    },
  });
  assert.deepEqual(resolved, {
    kind: "choose",
    targets: [
      { kind: "library", artist: LIBRARY[0] },
      { kind: "yt", name: "Justice", offline: true },
    ],
  });
  assert.deepEqual(requested, ["Justice"]);
});
