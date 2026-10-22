/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { artistNeighbourhood, type CatalogSong } from "@wave/core";
import * as Effect from "effect/Effect";

import { readArtistGraph, type ArtistGraphReads } from "./artistGraph.ts";

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
const store = (counts: { reads: number }, catalog: CatalogSong[] = []): ArtistGraphReads => ({
  graphCatalogPage: (after) =>
    Effect.sync(() => {
      counts.reads++;
      return {
        rows:
          after === 0
            ? catalog.map((entry) => ({ ...entry, videoId: entry.song.videoId, radios: [] }))
            : [],
        next: after === 0 && catalog.length > 0 ? 1 : null,
      };
    }),
  graphRadioPage: (after) =>
    Effect.succeed({
      rows:
        after === 0
          ? catalog.flatMap((entry) =>
              entry.radios.map((radio) => ({ ...radio, videoId: entry.song.videoId })),
            )
          : [],
      next: null,
    }),
  graphSimilarPage: (after) =>
    Effect.succeed({
      rows:
        after === ""
          ? [
              {
                name: "Portishead",
                similar: [{ name: "Beth Gibbons", browseId: "UCbeth", audience: null }],
              },
            ]
          : [],
      next: null,
    }),
  graphPlayPage: () =>
    Effect.succeed({
      rows: [
        { ...play("1", 0), artists: ["Massive Attack"] },
        { ...play("2", 4 * MINUTE), artists: ["Burial", "Kode9"] },
      ],
      next: null,
    }),
});

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
});
