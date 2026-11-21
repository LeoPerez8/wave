import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf } from "./localisation.ts";
import {
  artistGraph,
  completeMagicRadioBatch,
  DEFAULT_DJ_SETTINGS,
  DJ_DISCOVERIES,
  DJ_VARIETIES,
  djArtistTile,
  djVarietyCandidates,
  magicArtistKey,
  magicSignal,
  parseMagicSession,
  startDjQueue,
  startStreamedMagicQueue,
  ytTrackId,
  type DjSettings,
  type RankedRadioSong,
} from "./index.ts";

/** A graph where each artist's page lists the others as "Fans might also like", closest first. */
const graphOf = (pages: Record<string, string[]>) =>
  artistGraph({
    catalog: [],
    pages: Object.entries(pages).map(([name, similar]) => ({
      name,
      similar: similar.map((other) => ({ name: other, browseId: `UC${other}`, audience: null })),
    })),
    plays: [],
  });

/**
 * Picked is the selected artist. Near A and Near B are its direct neighbours,
 * Far A and Far B theirs (two hops out), Farther is three hops out and
 * Stranger isn't in the graph.
 */
const graph = graphOf({
  Picked: ["Near A", "Near B"],
  "Near A": ["Far A"],
  "Near B": ["Far B"],
  "Far A": ["Farther"],
});

let nextVideo = 0;

/** A ranked radio song by [artists], each call a new one. */
const songBy = (...artists: string[]): RankedRadioSong => {
  const videoId = `v${nextVideo++}`;
  return {
    trackId: ytTrackId(videoId),
    artists: artists.map(magicArtistKey),
    genre: null,
    style: null,
    source: "stream",
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
    radio: { id: "artist:picked", position: 0 },
    score: 10,
  };
};

/** [count] songs by each of [artists], the artists taking turns. */
const songsBy = (count: number, ...artists: string[]): RankedRadioSong[] =>
  Array.from({ length: count }, () => artists.map((artist) => songBy(artist))).flat();

const session = (settings: Partial<DjSettings> = {}, picked: string[] = ["Picked"]) =>
  startDjQueue(
    picked.map((name) => djArtistTile(name)!),
    { id: "dj1", settings: { ...DEFAULT_DJ_SETTINGS, ...settings } },
  )!;

/** Who the batch of 10 picked from [candidates] at [variety] credits, song by song. */
const batchArtists = (
  variety: DjSettings["variety"],
  candidates: readonly RankedRadioSong[],
  over: Parameters<typeof djVarietyCandidates>[1] = graph,
  liked: readonly RankedRadioSong[] = [],
): string[] => {
  const started = session({ variety });
  const pools = djVarietyCandidates(started, over, { seed: candidates, liked }, 10);
  return completeMagicRadioBatch(started, pools.seed, pools.liked).songs.map((song) =>
    song.song!.artists.join(" & "),
  );
};

const count = (artists: readonly string[], name: string): number =>
  artists.filter((artist) => artist === name).length;

describe("Artist variety in a DJ session", () => {
  test("offers Low, Medium and High, in that order", () => {
    assert.deepEqual(DJ_VARIETIES, ["low", "medium", "high"]);
  });

  test("Low keeps a batch to the selected artists", () => {
    const artists = batchArtists("low", songsBy(12, "Picked", "Near A", "Far A", "Stranger"));
    assert.equal(artists.length, 10);
    assert.deepEqual(new Set(artists), new Set(["Picked"]));
  });

  test("Low counts a song the selected artist shares with someone else", () => {
    const artists = batchArtists("low", [songBy("Stranger", "Picked"), ...songsBy(12, "Picked")]);
    assert.equal(artists[0], "Stranger & Picked");
  });

  test("Low fills a short batch from the direct neighbours only", () => {
    const artists = batchArtists("low", [
      ...songsBy(8, "Stranger", "Far A", "Near A", "Near B"),
      ...songsBy(3, "Picked"),
    ]);
    assert.equal(artists.length, 10);
    assert.equal(count(artists, "Picked"), 3);
    assert.equal(count(artists, "Near A") + count(artists, "Near B"), 7);
  });

  test("Medium adds the direct neighbours", () => {
    const artists = batchArtists(
      "medium",
      songsBy(6, "Stranger", "Far A", "Near A", "Picked", "Near B"),
    );
    assert.equal(artists.length, 10);
    assert.deepEqual(new Set(artists), new Set(["Picked", "Near A", "Near B"]));
    // Ranked ahead of Picked's songs, a neighbour's are not a fill: they're in at once.
    assert.equal(artists[0], "Near A");
  });

  test("Medium fills a short batch from two hops out before anyone else", () => {
    const artists = batchArtists("medium", [
      ...songsBy(4, "Stranger", "Farther"),
      ...songsBy(4, "Far B"),
      ...songsBy(3, "Picked", "Near A"),
    ]);
    assert.equal(artists.length, 10);
    assert.equal(count(artists, "Far B"), 4);
    assert.equal(count(artists, "Stranger") + count(artists, "Farther"), 0);
  });

  test("High allows the two-hop neighbourhood, an artist at most once per batch", () => {
    const candidates = [
      ...songsBy(3, "Picked", "Near A", "Near B", "Far A", "Far B", "Farther", "Stranger"),
      // More artists two hops out, so ten different ones are allowed.
      ...["Far C", "Far D", "Far E", "Far F", "Far G", "Far H"].map((name) => songBy(name)),
    ];
    const wide = graphOf({
      Picked: ["Near A", "Near B"],
      "Near A": ["Far A", "Far C", "Far D", "Far E"],
      "Near B": ["Far B", "Far F", "Far G", "Far H"],
      "Far A": ["Farther"],
    });
    const artists = batchArtists("high", candidates, wide);
    assert.equal(artists.length, 10);
    assert.equal(new Set(artists).size, 10);
    assert.equal(count(artists, "Farther") + count(artists, "Stranger"), 0);
    assert.ok(artists.includes("Far A") && artists.includes("Far B"));
  });

  test("High counts every artist a song credits", () => {
    const pools = djVarietyCandidates(session({ variety: "high" }), graph, {
      seed: [
        songBy("Picked", "Near A"),
        songBy("Near A"),
        songBy("Picked"),
        ...songsBy(2, "Near B", "Far A"),
      ],
      liked: [],
    });
    assert.deepEqual(
      pools.seed.map((song) => song.song!.artists.join(" & ")),
      ["Picked & Near A", "Near B", "Far A"],
    );
  });

  test("High fills a short batch with other artists once before repeating anyone", () => {
    const strangers = ["S1", "S2", "S3", "S4", "S5", "S6"];
    const artists = batchArtists("high", [
      ...songsBy(4, "Picked", "Near A"),
      ...strangers.flatMap((name) => songsBy(2, name)),
    ]);
    assert.equal(artists.length, 10);
    assert.equal(new Set(artists).size, 8);
    for (const name of strangers) assert.equal(count(artists, name), 1, name);
    // Nobody else is left, so the closest artist repeats.
    assert.equal(count(artists, "Picked"), 3);
  });

  test("a batch isn't left empty when the graph knows nobody", () => {
    for (const variety of DJ_VARIETIES) {
      for (const over of [null, graphOf({})]) {
        const artists = batchArtists(variety, songsBy(6, "Stranger", "Picked"), over);
        assert.equal(artists.length, 10, variety);
        assert.equal(count(artists, "Picked"), 6, variety);
      }
    }
  });

  test("asked for no fill, it gives only what the step allows", () => {
    const candidates = songsBy(2, "Picked", "Near A", "Far A", "Stranger");
    const allowed = (variety: DjSettings["variety"]) =>
      djVarietyCandidates(session({ variety }), graph, { seed: candidates, liked: [] }).seed.map(
        (song) => song.song!.artists[0],
      );
    assert.deepEqual(allowed("low"), ["Picked", "Picked"]);
    assert.deepEqual(allowed("medium"), ["Picked", "Near A", "Picked", "Near A"]);
    assert.deepEqual(allowed("high"), ["Picked", "Near A", "Far A"]);
  });

  test("limits the songs learned radios bring too", () => {
    const liked = songsBy(6, "Stranger", "Near A");
    const artists = batchArtists("low", songsBy(12, "Picked"), graph, liked);
    assert.equal(artists.length, 10);
    assert.deepEqual(new Set(artists), new Set(["Picked"]));
    // High holds an artist once across both pools.
    const once = djVarietyCandidates(session({ variety: "high" }), graph, {
      seed: songsBy(1, "Picked", "Near A"),
      liked,
    });
    assert.deepEqual(once.liked, []);
  });

  test("a short batch still comes out whole when a filled learned song repeats a seed one", () => {
    const seed = [...songsBy(4, "Picked"), ...songsBy(4, "Stranger")];
    // The learned radio brings one of the seed's songs again, and more by someone outside.
    const liked = [{ ...seed[5]! }, ...songsBy(3, "Stranger")];
    const artists = batchArtists("low", seed, null, liked);
    assert.equal(artists.length, 10);
    assert.equal(count(artists, "Picked"), 4);
  });

  test("a fill ranks behind the songs the step allows", () => {
    const pools = djVarietyCandidates(
      session({ variety: "low" }),
      graph,
      { seed: [...songsBy(12, "Stranger"), ...songsBy(2, "Picked")], liked: [] },
      10,
    );
    assert.deepEqual(
      pools.seed.slice(0, 3).map((song) => song.song!.artists[0]),
      ["Picked", "Picked", "Stranger"],
    );
  });

  test("every selected artist counts as picked", () => {
    const started = session({ variety: "low" }, ["Picked", "Stranger"]);
    const pools = djVarietyCandidates(
      started,
      graph,
      { seed: songsBy(6, "Stranger", "Picked", "Near A"), liked: [] },
      10,
    );
    assert.deepEqual(
      new Set(pools.seed.map((song) => song.song!.artists[0])),
      new Set(["Picked", "Stranger"]),
    );
  });

  test("the first batch covers selected artist tiles at every variety level", () => {
    for (const variety of DJ_VARIETIES) {
      const selected = ["A", "B", "C", "D"];
      const started = session({ variety }, selected);
      const candidates = [...songsBy(3, "A", "B", "C", "D"), ...songsBy(12, "A")];
      const pools = djVarietyCandidates(started, graphOf({}), { seed: candidates, liked: [] }, 10);
      const songs = completeMagicRadioBatch(started, pools.seed, pools.liked).songs;
      for (const artist of selected)
        assert.ok(
          songs.some((song) => song.song!.artists.includes(artist)),
          `${variety}: ${artist}`,
        );
    }
  });

  test("the first batch interleaves selected artists and covers at most ten", () => {
    const selected = Array.from({ length: 12 }, (_, index) => `Artist ${index}`);
    const started = session({ variety: "low" }, selected);
    const candidates = selected.flatMap((artist) => songsBy(3, artist));
    const pools = djVarietyCandidates(started, null, { seed: candidates, liked: [] }, 10);
    const songs = completeMagicRadioBatch(started, pools.seed, pools.liked).songs;
    const artists = songs.map((song) => song.song!.artists[0]!);
    assert.equal(new Set(artists).size, 10);
    for (let index = 1; index < artists.length; index++)
      assert.notEqual(artists[index], artists[index - 1]);
  });

  test("a selected artist without candidates is skipped", () => {
    const started = session({ variety: "low" }, ["A", "B", "Unavailable"]);
    const candidates = [...songsBy(5, "A"), ...songsBy(5, "B")];
    const pools = djVarietyCandidates(started, null, { seed: candidates, liked: [] }, 10);
    const songs = completeMagicRadioBatch(started, pools.seed, pools.liked).songs;
    assert.equal(songs.length, 10);
    assert.ok(songs.some((song) => song.song!.artists.includes("A")));
    assert.ok(songs.some((song) => song.song!.artists.includes("B")));
  });

  test("the first batch covers selected artists with Library-only songs", () => {
    const started = session({ variety: "low" }, ["A", "B"]);
    const candidates = ["A", "B"].flatMap((artist) =>
      songsBy(3, artist).map((song) => ({ ...song, song: null, source: "library" as const })),
    );
    const pools = djVarietyCandidates(started, null, { seed: candidates, liked: [] }, 10);
    const songs = completeMagicRadioBatch(started, pools.seed, pools.liked).songs;
    assert.ok(songs.some((song) => song.artists.includes(magicArtistKey("A"))));
    assert.ok(songs.some((song) => song.artists.includes(magicArtistKey("B"))));
  });

  test("leaves any other Magic Queue's candidates as they are", () => {
    const ordinary = startStreamedMagicQueue(songBy("Picked").song!, { id: "m1" }).session;
    const pools = { seed: songsBy(3, "Stranger", "Far A"), liked: songsBy(2, "Stranger") };
    assert.equal(djVarietyCandidates(ordinary, graph, pools, 10), pools);
  });
});

describe("Music discovery in a DJ session", () => {
  test("offers Familiar, Blend and Discover, in that order", () => {
    assert.deepEqual(DJ_DISCOVERIES, ["familiar", "blend", "discover"]);
  });

  test("Adjust's text is in both languages", () => {
    const pt = catalogueOf("pt-BR").dj;
    assert.equal(pt.adjust, "Ajustar");
    assert.equal(pt.artistVariety, "Variedade de artistas");
    assert.deepEqual(pt.varietySteps, { low: "Baixa", medium: "Média", high: "Alta" });
    assert.equal(pt.musicDiscovery, "Descoberta de música");
    assert.deepEqual(pt.discoverySteps, {
      familiar: "Conhecidas",
      blend: "Misturar",
      discover: "Descobrir",
    });
  });

  test("sets the New music share the session starts at", () => {
    assert.deepEqual(
      DJ_DISCOVERIES.map((discovery) => session({ discovery }).ytShare),
      [0.2, 0.6, 1],
    );
  });

  test("signals still move the share, within 20% and 100%", () => {
    const streamed = songBy("Near A");
    const skipped = (from: DjSettings["discovery"]) =>
      magicSignal(session({ discovery: from }), { kind: "skip", song: streamed }).ytShare;
    const starred = (from: DjSettings["discovery"]) =>
      magicSignal(session({ discovery: from }), { kind: "favorite", song: streamed }).ytShare;
    assert.equal(skipped("familiar"), 0.2);
    assert.equal(skipped("blend"), 0.5);
    assert.equal(starred("blend"), 0.7);
    assert.equal(starred("discover"), 1);
  });

  test("the choices are saved with the session and read back after a restart", () => {
    const chosen = session({ variety: "high", discovery: "familiar" });
    const read = parseMagicSession(JSON.parse(JSON.stringify(chosen)))!;
    assert.deepEqual(read.dj, { ...DEFAULT_DJ_SETTINGS, variety: "high", discovery: "familiar" });
    assert.equal(read.ytShare, 0.2);
    const candidates = songsBy(12, "Stranger", "Picked", "Near A", "Far A");
    assert.deepEqual(
      djVarietyCandidates(read, graph, { seed: candidates, liked: [] }, 10),
      djVarietyCandidates(chosen, graph, { seed: candidates, liked: [] }, 10),
    );
  });
});
