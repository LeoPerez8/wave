/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { artistNeighbourhood, type CatalogSong, type TasteHistory } from "@wave/core";
import * as Effect from "effect/Effect";

import { artistGraphOnce, readArtistGraph, type ArtistGraphReads } from "./artistGraph.ts";

const MINUTE = 60_000;

const radioSong = (videoId: string, artist: string, seed: string): CatalogSong => ({
  song: {
    videoId,
    title: videoId,
    artists: [artist],
    album: null,
    albumId: null,
    durationMs: null,
    artworkUrl: null,
    explicit: false,
  },
  firstSeenAt: 0,
  lastSeenAt: 0,
  radios: [{ seed: seed.toLowerCase(), seedName: seed, lastSeenAt: 0 }],
});

const play = (trackId: string, startedAt: number) => ({
  trackId,
  startedAt,
  listenedMs: 3 * MINUTE,
  endReason: "completed" as const,
});

/** A store with [catalog], one saved page and two Library songs played one after the other. */
const store = (counts: { reads: number }, catalog: CatalogSong[] = []): ArtistGraphReads =>
  ({
    candidateCatalog: Effect.sync(() => {
      counts.reads++;
      return catalog;
    }),
    ytArtistSimilar: Effect.succeed([
      {
        name: "Portishead",
        similar: [{ name: "Beth Gibbons", browseId: "UCbeth", audience: null }],
      },
    ]),
    tasteHistory: Effect.succeed({
      plays: [play("2", 4 * MINUTE), play("1", 0), play("3", 8 * MINUTE)],
      favorites: [],
      downloads: [],
    } satisfies TasteHistory),
    listSongs: Effect.succeed([
      { id: 1, artistIds: [10] },
      { id: 2, artistIds: [11, 12] },
    ]),
    listArtists: Effect.succeed([
      { id: 10, name: "Massive Attack" },
      { id: 11, name: "Burial" },
      { id: 12, name: "Kode9" },
    ]),
  }) as unknown as ArtistGraphReads;

describe("the artist graph the app derives", () => {
  test("joins the catalog's radios, the saved pages and the Library's play history", () => {
    const graph = Effect.runSync(
      readArtistGraph(store({ reads: 0 }, [radioSong("p1", "Portishead", "Massive Attack")])),
    );
    assert.deepEqual(
      artistNeighbourhood(graph, ["Massive Attack"]).map(({ name, hops }) => [name, hops]),
      [
        ["Portishead", 1],
        ["Burial", 1],
        ["Kode9", 1],
        ["Beth Gibbons", 2],
      ],
    );
  });

  test("is derived once per session, again when forgotten, and a failed read isn't kept", async () => {
    const counts = { reads: 0 };
    let fail = true;
    const once = artistGraphOnce(() =>
      fail
        ? Promise.reject(new Error("unreadable"))
        : Effect.runPromise(readArtistGraph(store(counts))),
    );
    assert.equal(await Effect.runPromise(once.now), null);
    fail = false;
    const graph = await Effect.runPromise(once.now);
    assert.notEqual(graph, null);
    assert.equal(await Effect.runPromise(once.now), graph);
    assert.equal(counts.reads, 1);
    once.forget();
    assert.notEqual(await Effect.runPromise(once.now), graph);
    assert.equal(counts.reads, 2);
  });
});
