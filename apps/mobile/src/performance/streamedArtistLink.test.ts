import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import * as Effect from "effect/Effect";
import {
  streamedArtistLink,
  resolveStreamedArtistLink,
  artistPhotoName,
  itemActions,
} from "@wave/core";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";
import { traceQueries, type TracedQuery } from "../library/db/testDatabase.ts";
import { readLinkArtists } from "../library/artistLookup.ts";
import { nowPlayingLibraryArtistLink } from "../nowPlaying/artistLink.ts";
import { followNowPlayingLink } from "../nowPlaying/linkClose.ts";
import { stepNowPlayingSheet } from "@wave/core";

const root = resolve(import.meta.dirname, "../../../..");
test("at 1,000 songs first-frame artist links read nothing; tap work is bounded names plus one row", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const name = "Artist 0";
    const queries: TracedQuery[] = [];
    const read = <A>(effect: Effect.Effect<A, unknown>) => {
      const result = traceQueries(fixture.db, () => Effect.runSync(effect));
      queries.push(...result.queries);
      return result.result;
    };
    const context = { enabled: true, here: "/library/songs", libraryArtist: null };
    const opening = traceQueries(fixture.db, () => streamedArtistLink([name], context));
    assert.equal(opening.queries.length, 0);
    assert.deepEqual(opening.result, { kind: "open", target: { kind: "unread", name } });
    const menu = itemActions({
      kind: "track",
      surface: "menu",
      selectable: false,
      onlineLookups: false,
      here: context.here,
      streamedArtists: context,
      items: [{ artistNames: [name], streamed: true }],
    });
    assert.ok(menu.some((entry) => entry.action === "goToArtist"));
    const link = await resolveStreamedArtistLink(opening.result!, context, {
      online: false,
      read: async (names, signal) => {
        const rows = await readLinkArtists(names, {
          signal,
          readPage: async (after) => read(store.artistNamesForLink(after)),
          readArtist: async (id) => read(store.linkRows({ artistId: id })).artist,
        });
        return (name) => rows.get(artistPhotoName(name)) ?? null;
      },
    });
    assert.deepEqual(link, {
      kind: "open",
      target: {
        kind: "library",
        artist: Effect.runSync(store.linkRows({ artistId: fixture.targets.small.artistId })).artist,
      },
    });
    assert.equal(queries.length, 2);
    assert.ok(queries[0]!.rows <= 128);
    assert.equal(queries[1]!.rows, 1);
    assert.ok(queries[0]!.plan.some((step) => step.includes("artists_sort_idx")));

    queries.length = 0;
    const events: string[] = [];
    const line = nowPlayingLibraryArtistLink({
      trackId: fixture.targets.small.songIds[0]!,
      details: null,
      here: context.here,
      read: async (id) => read(store.trackDetails(id)),
      follow: (link) => events.push(link.kind),
      reveal: () => events.push("here"),
      unavailable: () => assert.fail("local credits"),
    });
    assert.equal(queries.length, 0);
    followNowPlayingLink({
      step: (event) => {
        events.push("close");
        return stepNowPlayingSheet("opening", event);
      },
      navigate: () => {
        void line.open();
      },
    });
    assert.equal(events[0], "close");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["close", "open"]);
    assert.equal(queries.length, 1);
    assert.equal(queries[0]!.rows, 1);
  } finally {
    fixture.close();
  }
});

test("at 1,000 songs cold taps page names, warm taps read nothing, and an absent artist opens offline", async () => {
  const { createArtistLinkFixture } = await import("../../bench/fastAgain/artistLinkFixture.ts");
  const { createArtistLinkLookup } = await import("../library/artistLookup.ts");
  const fixture = await createArtistLinkFixture(500, 1000);
  try {
    const store = await loadLibraryStore(root, fixture.db);
    for (const [person, rows, statements] of [
      [fixture.first, 129, 2],
      [fixture.middle, 257, 3],
      [fixture.last, 501, 5],
      [{ id: null, name: "Justice" }, 500, 4],
    ] as const) {
      const queries: TracedQuery[] = [];
      let notifications = 0;
      const read = <A>(effect: Effect.Effect<A, unknown>) => {
        const traced = traceQueries(fixture.db, () => Effect.runSync(effect));
        queries.push(...traced.queries);
        return traced.result;
      };
      const lookup = createArtistLinkLookup({
        version: () => 1,
        readPage: async (after) => read(store.artistNamesForLink(after)),
        readArtist: async (id) => read(store.linkRows({ artistId: id })).artist,
      });
      const stop = lookup.subscribe(() => {
        notifications++;
      });
      const context = { enabled: true, here: "/library/songs", libraryArtist: lookup.find };
      const unread = streamedArtistLink([person.name], context)!;
      assert.equal(queries.length, 0);
      const expected =
        person.id === null
          ? { kind: "open", target: { kind: "yt", name: "Justice", offline: true } }
          : {
              kind: "open",
              target: {
                kind: "library",
                artist: Effect.runSync(store.linkRows({ artistId: person.id })).artist,
              },
            };
      assert.deepEqual(
        await resolveStreamedArtistLink(unread, context, { online: false, read: lookup.read }),
        expected,
      );
      assert.equal(queries.length, statements);
      assert.equal(
        queries.reduce((sum, q) => sum + q.rows, 0),
        rows,
      );
      assert.ok(queries.every((q) => q.rows <= 128));
      assert.equal(notifications, 1);
      queries.length = 0;
      assert.deepEqual(
        await resolveStreamedArtistLink(streamedArtistLink([person.name], context)!, context, {
          online: false,
          read: lookup.read,
        }),
        expected,
      );
      assert.equal(queries.length, 0);
      assert.equal(notifications, 1);
      stop();
    }
  } finally {
    fixture.close();
  }
});
