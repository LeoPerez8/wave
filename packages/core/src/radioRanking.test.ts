import assert from "node:assert/strict";
import { test } from "node:test";
import {
  rankRadioSongs,
  startMagicQueue,
  magicSignal,
  parseMagicSession,
  radioRankingBatch,
  magicArtistKey,
  magicYtSong,
  artistGraph,
  type YtAlbumSong,
} from "./index.ts";

const song = (videoId: string, artist = videoId): YtAlbumSong => ({
  videoId,
  title: videoId,
  artists: [artist],
  album: null,
  albumId: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
});
const page = {
  id: "song:seed",
  artists: ["Seed"],
  songs: [song("first"), song("second"), song("third")],
};
test("radio order leads and every result keeps its radio and position", () => {
  const ranked = rankRadioSongs({ artists: ["Seed"] }, { pages: [page] });
  assert.deepEqual(
    ranked.map(({ trackId }) => trackId),
    ["yt:first", "yt:second", "yt:third"],
  );
  assert.deepEqual(ranked[0]?.radio, { id: "song:seed", position: 0 });
  assert.ok(ranked[0]!.score > ranked[1]!.score);
});
test("unknown genres stay at every step; known incompatible genres get the selected penalty", () => {
  const seed = { artists: ["Seed"], profile: new Map([["reggae", 1]]) };
  const sources = {
    pages: [page],
    profileOf: (name: string) => (name === "first" ? new Map([["metal", 1]]) : null),
  };
  for (const faithfulness of [1, 2, 3, 4, 5] as const) {
    const ranked = rankRadioSongs(seed, sources, { faithfulness });
    assert.ok(ranked.some(({ trackId }) => trackId === "yt:second"));
    assert.equal(
      ranked.some(({ trackId }) => trackId === "yt:first"),
      faithfulness !== 1,
    );
  }
  const score = (faithfulness: 2 | 3 | 4 | 5) =>
    rankRadioSongs(seed, sources, { faithfulness }).find((s) => s.trackId === "yt:first")!.score;
  assert.ok(score(2) < score(3));
  assert.ok(score(3) < score(4));
  assert.equal(score(5), 10);
});
const librarySong = (trackId: string, artist: string) => ({
  trackId,
  artists: [magicArtistKey(artist)],
  genre: null,
  style: null,
});
test("Library songs join from the radio, seed artists or graph neighbours regardless of genre", () => {
  const radio = librarySong("1", "Unrelated");
  const neighbour = librarySong("2", "Neighbour");
  const seedSong = librarySong("3", "Seed");
  const unrelated = librarySong("4", "Elsewhere");
  const graph = artistGraph({
    catalog: [],
    plays: [],
    pages: [{ name: "Seed", similar: [{ name: "Neighbour", browseId: "n", audience: null }] }],
  });
  const ranked = rankRadioSongs(
    { artists: ["Seed"], profile: new Map([["reggae", 1]]) },
    {
      pages: [page],
      graph,
      library: [radio, neighbour, seedSong, unrelated],
      inLibrary: (s) => (s.videoId === "first" ? radio : null),
      profileOf: () => new Map([["metal", 1]]),
    },
    { faithfulness: 1 },
  );
  assert.deepEqual(ranked.map((s) => s.trackId).toSorted(), ["1", "2", "3"]);
  assert.equal(ranked.find((s) => s.trackId === "1")?.source, "library");
});
test("skips lower the artist's next song; positive signals and taste reorder radio songs", () => {
  const sources = { pages: [{ ...page, songs: [song("first", "A"), song("second", "B")] }] };
  const skipped = {
    kind: "skip" as const,
    song: { ...magicYtSong({ trackId: "yt:earlier", artists: ["A"] }, () => null) },
  };
  assert.equal(
    rankRadioSongs({ artists: ["Seed"] }, { ...sources, signals: [skipped] })[0]?.trackId,
    "yt:second",
  );
  for (const kind of ["favorite", "download", "playedThrough", "added"] as const) {
    const positive = {
      kind,
      song: magicYtSong({ trackId: "yt:second", artists: ["B"] }, () => null),
    };
    assert.equal(
      rankRadioSongs({ artists: ["Seed"] }, { ...sources, signals: [positive] })[0]?.trackId,
      "yt:second",
    );
  }
  const taste = {
    at: 0,
    songs: new Map([["yt:second", 100]]),
    artists: new Map(),
    genres: new Map(),
  };
  assert.equal(
    rankRadioSongs({ artists: ["Seed"] }, { ...sources, taste })[0]?.trackId,
    "yt:second",
  );
});
test("played and removed songs stay out, including their Library identities, and duplicates keep the best radio position", () => {
  const local = magicYtSong({ trackId: "1", artists: ["first"] }, () => null);
  const ranked = rankRadioSongs(
    { artists: ["Seed"] },
    {
      pages: [page, { ...page, id: "other", songs: [song("second"), song("first")] }],
      inLibrary: (s) => (s.videoId === "first" ? local : null),
      signals: [
        {
          kind: "removed",
          song: magicYtSong({ trackId: "yt:third", artists: ["third"] }, () => null),
        },
      ],
    },
    { exclude: new Set(["yt:first"]) },
  );
  assert.deepEqual(
    ranked.map((s) => s.trackId),
    ["yt:second"],
  );
  assert.deepEqual(ranked[0]?.radio, { id: "other", position: 0 });
});
test("a batch preserves radio rank within New music's share and fills a short pool", () => {
  const library = Array.from({ length: 10 }, (_, i) =>
    magicYtSong({ trackId: String(i), artists: ["Seed"] }, () => null),
  );
  const ranked = rankRadioSongs(
    { artists: ["Seed"] },
    { pages: [{ ...page, songs: Array.from({ length: 12 }, (_, i) => song(`v${i}`)) }], library },
  );
  const batch = radioRankingBatch(ranked, { size: 9, newMusicShare: 0.6 });
  assert.equal(batch.length, 9);
  assert.equal(batch.filter((s) => s.source === "stream").length, 5);
  assert.deepEqual(
    batch.filter((s) => s.source === "stream").map((s) => s.trackId),
    ["yt:v0", "yt:v1", "yt:v2", "yt:v3", "yt:v4"],
  );
  assert.equal(
    radioRankingBatch(
      ranked.filter((s) => s.source === "stream"),
      { size: 9, newMusicShare: 0.2 },
    ).length,
    9,
  );
});
test("excluding a radio video's Library identity also excludes the artist's Library addition", () => {
  const local = magicYtSong({ trackId: "1", artists: ["Seed"] }, () => null);
  const ranked = rankRadioSongs(
    { artists: ["Seed"] },
    { pages: [page], library: [local], inLibrary: (s) => (s.videoId === "first" ? local : null) },
    { exclude: new Set(["yt:first"]) },
  );
  assert.ok(ranked.every((candidate) => candidate.trackId !== "1"));
});
test("the same radio recording under another video id is offered once", () => {
  const ranked = rankRadioSongs(
    { artists: ["Seed"] },
    {
      pages: [{ ...page, songs: [song("a", "A"), { ...song("b", "A"), title: "a (Remastered)" }] }],
    },
  );
  assert.deepEqual(
    ranked.map((candidate) => candidate.trackId),
    ["yt:a"],
  );
});
test("radio seeds and ranking signals survive a saved Magic Queue and old sessions still load", () => {
  const started = startMagicQueue(
    { kind: "track", id: "1", title: "Seed" },
    [magicYtSong({ trackId: "1", artists: ["Seed"] }, () => null)],
    {
      id: "session",
      random: () => 0,
      radio: {
        artists: ["Seed"],
        profile: null,
        song: { id: "song:1", title: "Seed", artists: ["Seed"], durationMs: 180000 },
      },
    },
  );
  assert.ok(started);
  const learned = magicSignal(started.session, {
    kind: "skip",
    song: magicYtSong({ trackId: "yt:skip", artists: ["Skipped"] }, () => null),
  });
  assert.deepEqual(parseMagicSession(JSON.parse(JSON.stringify(learned))), learned);
  const { radioSeed: _radioSeed, radioSignals: _radioSignals, ...legacy } = learned;
  assert.equal(parseMagicSession(legacy)?.radioSeed, undefined);
  assert.equal(parseMagicSession(legacy)?.radioSignals, undefined);
});
