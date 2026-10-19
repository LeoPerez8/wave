import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  artistNeighbourhood,
  artistNeighbours,
  type ArtistGraphPlay,
  type CatalogSong,
} from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60_000;

/** A catalog song by [artists] that the radios of [seeds] brought. */
const catalogSong = (videoId: string, artists: string[], seeds: string[]): CatalogSong => ({
  song: {
    videoId,
    title: `Song ${videoId}`,
    artists,
    album: null,
    albumId: null,
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
  },
  firstSeenAt: DAY,
  lastSeenAt: DAY,
  radios: seeds.map((seedName) => ({
    seed: seedName.toLowerCase(),
    seedName,
    lastSeenAt: DAY,
  })),
});

const names = (neighbours: readonly { readonly name: string }[]): string[] =>
  neighbours.map((neighbour) => neighbour.name);

const none = { catalog: [], pages: [], plays: [] };

/** An artist a page lists as similar. */
const similar = (name: string) => ({ name, browseId: `UC${name}`, audience: null });

/** [songs] songs by [artist] that [seed]'s radio brought. */
const radio = (artist: string, seed: string, songs: number): CatalogSong[] =>
  Array.from({ length: songs }, (_, i) => catalogSong(`${artist}${i}`, [artist], [seed]));

/** The closeness of each of [neighbours], in their order. */
const closenesses = (neighbours: readonly { readonly closeness: number }[]): number[] =>
  neighbours.map((neighbour) => neighbour.closeness);

describe("An artist's neighbours", () => {
  test("from radio co-occurrence: the more of a seed's radio is an artist's, the closer", () => {
    const graph = artistGraph({
      ...none,
      catalog: [
        catalogSong("a1", ["Massive Attack"], ["Massive Attack"]),
        catalogSong("p1", ["Portishead"], ["Massive Attack"]),
        catalogSong("p2", ["Portishead"], ["Massive Attack"]),
        catalogSong("t1", ["Tricky"], ["Massive Attack"]),
      ],
    });
    assert.deepEqual(names(artistNeighbours(graph, "Massive Attack")), ["Portishead", "Tricky"]);
  });

  test("from a saved artist page's similar artists: earlier on the list is closer, both ways", () => {
    const graph = artistGraph({
      ...none,
      pages: [
        { name: "Massive Attack", similar: [similar("Tricky"), similar("Portishead")] },
        { name: "Björk" },
      ],
    });
    assert.deepEqual(names(artistNeighbours(graph, "Massive Attack")), ["Tricky", "Portishead"]);
    assert.deepEqual(names(artistNeighbours(graph, "portishead")), ["Massive Attack"]);
    assert.deepEqual(artistNeighbours(graph, "Björk"), []);
  });

  test("from the owner's sessions: artists played one after the other, less than 30 minutes apart", () => {
    const play = (
      artists: string[],
      startedAt: number,
      { listenedMs = 4 * MINUTE, endReason = "completed" as ArtistGraphPlay["endReason"] } = {},
    ): ArtistGraphPlay => ({ artists, startedAt, listenedMs, endReason });
    const graph = artistGraph({
      ...none,
      plays: [
        play(["Tricky"], 3 * 60 * MINUTE),
        play(["Massive Attack"], 0),
        play(["Björk"], 9 * MINUTE, { listenedMs: 10_000, endReason: "skipped" }),
        play(["Portishead"], 10 * MINUTE),
        play(["Massive Attack"], 15 * MINUTE),
        play(["Portishead"], 20 * MINUTE),
        play(["Massive Attack"], 30 * MINUTE),
        play(["Massive Attack"], 35 * MINUTE),
        play(["Burial"], 40 * MINUTE, { listenedMs: 2 * MINUTE }),
        // Played more than 30 minutes after Burial's ended.
        play(["Tricky"], 73 * MINUTE),
      ],
    });
    assert.deepEqual(names(artistNeighbours(graph, "Massive Attack")), ["Portishead", "Burial"]);
    assert.deepEqual(names(artistNeighbours(graph, "Burial")), ["Massive Attack"]);
    assert.deepEqual(artistNeighbours(graph, "Björk"), []);
    assert.deepEqual(artistNeighbours(graph, "Tricky"), []);
  });

  test("combine the three sources, ranked by how close they make each artist", () => {
    const sources = {
      catalog: [
        catalogSong("t1", ["Tricky"], ["Massive Attack"]),
        catalogSong("t2", ["Tricky"], ["Massive Attack"]),
        catalogSong("t3", ["Tricky"], ["Massive Attack"]),
        catalogSong("p1", ["Portishead"], ["Massive Attack"]),
      ],
      pages: [
        {
          name: "Massive Attack",
          similar: [{ name: "Portishead", browseId: "UCportishead", audience: null }],
        },
      ],
      plays: [
        { artists: ["Massive Attack"], startedAt: 0, listenedMs: MINUTE, endReason: "completed" },
        { artists: ["Burial"], startedAt: 2 * MINUTE, listenedMs: MINUTE, endReason: "completed" },
      ] satisfies ArtistGraphPlay[],
    };
    const neighbours = artistNeighbours(artistGraph(sources), "Massive Attack");
    assert.deepEqual(names(neighbours), ["Portishead", "Tricky", "Burial"]);
    for (const { closeness } of neighbours) assert.ok(closeness > 0 && closeness <= 1);
    const radioOnly = artistGraph(sources, { radio: 1, similar: 0, session: 0 });
    assert.deepEqual(names(artistNeighbours(radioOnly, "Massive Attack")), [
      "Tricky",
      "Portishead",
    ]);
  });
});

describe("Artists in the graph", () => {
  test("are matched as artists are elsewhere, and 'Various Artists' never joins", () => {
    const graph = artistGraph({
      catalog: [
        catalogSong("v1", ["Various Artists"], ["Massive Attack"]),
        catalogSong("p1", ["PORTISHEAD"], ["Massive Attack"]),
        catalogSong("m1", ["Massive Attack"], ["Various Artists"]),
      ],
      pages: [
        {
          name: "Various Artists",
          similar: [{ name: "Tricky", browseId: "UCtricky", audience: null }],
        },
      ],
      plays: [
        { artists: ["Unknown Artist"], startedAt: 0, listenedMs: MINUTE, endReason: "completed" },
        { artists: ["Massive Attack"], startedAt: MINUTE, listenedMs: 0, endReason: "completed" },
      ],
    });
    assert.deepEqual(names(artistNeighbours(graph, "the massive attack")), ["PORTISHEAD"]);
    assert.deepEqual(artistNeighbours(graph, "Various Artists"), []);
    assert.deepEqual(artistNeighbours(graph, "Tricky"), []);
    assert.deepEqual(artistNeighbourhood(graph, ["Various Artists", "Unknown Artist"]), []);
  });
});

describe("An artist's neighbourhood", () => {
  const graph = artistGraph({
    ...none,
    catalog: [
      catalogSong("p1", ["Portishead"], ["Massive Attack"]),
      catalogSong("p2", ["Portishead"], ["Massive Attack"]),
      catalogSong("t1", ["Tricky"], ["Massive Attack"]),
    ],
    pages: [
      {
        name: "Portishead",
        similar: [{ name: "Beth Gibbons", browseId: "UCbeth", audience: null }],
      },
      {
        name: "Beth Gibbons",
        similar: [{ name: "Rustin Man", browseId: "UCrustin", audience: null }],
      },
    ],
  });

  test("two hops out ranks second-hop artists below first-hop ones, with decaying closeness", () => {
    const around = artistNeighbourhood(graph, ["Massive Attack"]);
    assert.deepEqual(
      around.map(({ name, hops }) => [name, hops]),
      [
        ["Portishead", 1],
        ["Tricky", 1],
        ["Beth Gibbons", 2],
      ],
    );
    const [portishead = 0, tricky = 0, beth = 0] = closenesses(around);
    assert.ok(beth < tricky);
    assert.ok(tricky < portishead);
    assert.ok(beth > 0);
  });

  test("a second-hop artist stays below a first-hop one even through a much closer path", () => {
    const close = artistGraph({
      ...none,
      catalog: [
        ...radio("Portishead", "Massive Attack", 12),
        ...radio("Tricky", "Massive Attack", 1),
        ...radio("Beth Gibbons", "Portishead", 12),
      ],
    });
    const around = artistNeighbourhood(close, ["Massive Attack"]);
    assert.deepEqual(names(around), ["Portishead", "Tricky", "Beth Gibbons"]);
    const [, tricky = 0, beth = 0] = closenesses(around);
    assert.ok(beth < tricky);
    assert.ok(beth > 0);
  });

  test("goes as many hops out as asked, and leaves out the seeds", () => {
    assert.deepEqual(names(artistNeighbourhood(graph, ["Massive Attack"], { hops: 1 })), [
      "Portishead",
      "Tricky",
    ]);
    assert.deepEqual(names(artistNeighbourhood(graph, ["Massive Attack"], { hops: 3 })), [
      "Portishead",
      "Tricky",
      "Beth Gibbons",
      "Rustin Man",
    ]);
    assert.deepEqual(names(artistNeighbourhood(graph, ["Massive Attack", "Portishead"])), [
      "Beth Gibbons",
      "Tricky",
      "Rustin Man",
    ]);
  });
});
