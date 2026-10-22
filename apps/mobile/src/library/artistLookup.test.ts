import assert from "node:assert/strict";
import test from "node:test";
import { findLinkArtists } from "./artistLookup.ts";

test("tap lookup reads small name pages, matches photo names, and stops once every credit is found", async () => {
  const pages = [
    [
      { id: 1, name: "Björk", sort: "bjork" },
      { id: 2, name: "Earth, Wind & Fire", sort: "earth" },
    ],
    [{ id: 3, name: "Justice", sort: "justice" }],
  ];
  let reads = 0;
  const artists = await findLinkArtists(["BJORK", "Earth Wind and Fire"], {
    readPage: async () => {
      reads++;
      return pages.shift() ?? [];
    },
    signal: new AbortController().signal,
  });
  assert.deepEqual(
    [...artists.values()].map((artist) => artist.id),
    [1, 2],
  );
  assert.equal(reads, 1);
});

test("a cancelled lookup does no further page reads", async () => {
  const controller = new AbortController();
  let reads = 0;
  await findLinkArtists(["Justice"], {
    signal: controller.signal,
    readPage: async () => {
      reads++;
      controller.abort();
      return [{ id: 1, name: "Björk", sort: "bjork" }];
    },
  });
  assert.equal(reads, 1);
});

test("a requested artist is cached without treating other names as absent", async () => {
  const { createArtistLinkLookup } = await import("./artistLookup.ts");
  let pages = 0;
  let rows = 0;
  let notifications = 0;
  const lookup = createArtistLinkLookup({
    version: () => 1,
    readPage: async () => {
      pages++;
      return [{ id: 3, name: "Björk", sort: "bjork" }];
    },
    readArtist: async (id) => {
      rows++;
      return { id, name: "Björk" };
    },
  });
  const stop = lookup.subscribe(() => {
    notifications++;
  });
  assert.equal(lookup.find("BJORK"), undefined);
  const find = await lookup.read(["BJORK"], new AbortController().signal);
  assert.deepEqual(find("The Björk"), { id: 3, name: "Björk" });
  assert.equal(lookup.find("Justice"), undefined);
  await lookup.read(["Björk"], new AbortController().signal);
  assert.equal(pages, 1);
  assert.equal(rows, 1);
  assert.equal(notifications, 1);
  stop();
});

test("pages yield to other tasks before continuing and a short final page ends a miss", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  const reading = findLinkArtists(["Justice"], {
    signal: new AbortController().signal,
    readPage: async () => {
      reads++;
      return reads === 1
        ? Array.from({ length: 128 }, (_, id) => ({ id, name: `Artist ${id}`, sort: String(id) }))
        : [];
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reads, 1);
  t.mock.timers.tick(0);
  assert.equal((await reading).size, 0);
  assert.equal(reads, 2);
});

test("a version change or cancellation cannot publish an outdated lookup", async () => {
  const { createArtistLinkLookup } = await import("./artistLookup.ts");
  for (const cancel of [false, true]) {
    let version = 1;
    let notifications = 0;
    let finish!: (page: readonly { id: number; name: string; sort: string }[]) => void;
    const controller = new AbortController();
    const lookup = createArtistLinkLookup({
      version: () => version,
      readPage: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      readArtist: async (id) => ({ id, name: "Björk" }),
    });
    const stop = lookup.subscribe(() => {
      notifications++;
    });
    const reading = lookup.read(["Björk"], controller.signal);
    if (cancel) controller.abort();
    else version++;
    finish([{ id: 3, name: "Björk", sort: "bjork" }]);
    await reading;
    assert.equal(lookup.find("Björk"), undefined);
    assert.equal(notifications, 0);
    stop();
  }
});
