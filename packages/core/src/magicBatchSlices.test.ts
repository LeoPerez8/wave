/**
 * #1448: a Magic Queue batch's own ranking after the radios' (the batch's
 * completion, Artist variety, New releases and the mood filter) runs in background
 * slices, a few candidates per step, and picks the same batch as in one go.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  availableMagicSongs,
  availableMagicSongsSteps,
  artistGraph,
  completeMagicRadioBatch,
  completeMagicRadioBatchSteps,
  DEFAULT_DJ_SETTINGS,
  djMoodFiltered,
  djMoodFilteredSteps,
  djNewReleasesRanked,
  djNewReleasesRankedSteps,
  djVarietyCandidates,
  djVarietyCandidatesSteps,
  finishSteps,
  libraryGenreProfiles,
  libraryGenreProfilesSteps,
  libraryMixProfilesSteps,
  magicArtistKey,
  magicRadioExclusions,
  magicRadioExclusionsSteps,
  rankRadioSongs,
  rankRadioSongsSteps,
  startMagicQueue,
  ytTrackId,
  type DjAudioFeatures,
  type DjReleasePage,
  type MagicSession,
  type RankedRadioSong,
  type YtAlbumSong,
} from "./index.ts";

/** The reference phone's seed: 3,000 Library songs. */
const LIBRARY = 3000;
const NOW = Date.UTC(2026, 10, 22);

const stream = (i: number, pool: string): RankedRadioSong => ({
  trackId: ytTrackId(`${pool}${i}`),
  artists: [magicArtistKey(`Artist ${i % 400}`)],
  genre: i % 3 === 0 ? "rock" : null,
  style: null,
  source: "stream",
  score: 10 - (i % 37) / 10,
  radio: { id: `song:${pool}`, position: i },
  song: {
    videoId: `${pool}${i}`,
    // Repeated titles, so recordings match across pools and inside them.
    title: `Song ${i % 700}${i % 5 === 0 ? " (Live)" : ""}`,
    artists: [`Artist ${i % 400}`],
    album: `Album ${i % 50}`,
    albumId: `MPRE${i % 50}`,
    durationMs: 180000 + (i % 9) * 1000,
    artworkUrl: null,
    explicit: false,
  },
});

const library = (i: number): RankedRadioSong => ({
  trackId: String(i),
  artists: [magicArtistKey(`Artist ${i % 400}`)],
  genre: i % 2 === 0 ? "rock" : "pop",
  style: null,
  source: "library",
  score: 3 + (i % 3),
  radio: null,
  song: null,
});

const seed = [
  ...Array.from({ length: 300 }, (_, i) => stream(i, "s")),
  ...Array.from({ length: LIBRARY }, (_, i) => library(i)),
];
const liked = Array.from({ length: 300 }, (_, i) => stream(i, "l"));

const started = startMagicQueue(
  { kind: "track", id: "seed", title: "seed" },
  [{ trackId: "seed", artists: [magicArtistKey("Artist 1")], genre: null, style: null }],
  { id: "session", random: () => 0, ytShare: 0.5 },
)!.session;

const session: MagicSession = {
  ...started,
  batches: 3,
  used: [
    ...Array.from({ length: 400 }, (_, i) => ytTrackId(`s${i * 3}`)),
    ...Array.from({ length: 200 }, (_, i) => String(i * 7)),
  ],
  likedRadios: Array.from({ length: 8 }, (_, i) => ({
    id: `song:r${i}`,
    title: `Song ${i * 11}`,
    artists: [`Artist ${i * 11}`],
    durationMs: 180000,
    videoId: `r${i}`,
  })),
};

const dj: MagicSession = {
  ...session,
  radioArtists: ["Artist 1", "Artist 2"],
  dj: { ...DEFAULT_DJ_SETTINGS, variety: "high", mood: ["energetic"], newReleases: true },
};

const graph = artistGraph({
  catalog: [],
  pages: Array.from({ length: 400 }, (_, i) => ({
    name: `Artist ${i}`,
    similar: [`Artist ${(i + 1) % 400}`, `Artist ${(i + 7) % 400}`].map((name) => ({
      name,
      browseId: `UC${name}`,
      audience: null,
    })),
  })),
  plays: [],
});

const pages: DjReleasePage[] = Array.from({ length: 20 }, (_, i) => ({
  name: `Artist ${i}`,
  albums: [
    {
      browseId: `MPRE${i}`,
      title: `Album ${i}`,
      year: 2026,
      artworkUrl: null,
      kind: "album",
    } as DjReleasePage["albums"][number],
  ],
  singles: [],
}));

const features = new Map<string, DjAudioFeatures>(
  Array.from({ length: 150 }, (_, i) => [
    `s${i * 2}`,
    { energy: (i % 10) / 10, valence: 0.5, acousticness: 0.2, mode: 1 },
  ]),
);
const libraryFeatures = new Map<string, DjAudioFeatures>(
  Array.from({ length: 500 }, (_, i) => [
    String(i * 5),
    { energy: (i % 7) / 7, valence: 0.4, acousticness: 0.6, mode: 0 },
  ]),
);
const genres = new Map<string, string | null>(
  Array.from({ length: 100 }, (_, i) => [`s${i}`, i % 2 === 0 ? "metal" : "folk"]),
);

/** A short digest of a list of ids, to pin a long result to what it was before slicing. */
const digest = (ids: readonly string[]): string => {
  let hash = 0x811c9dc5;
  for (const char of ids.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${ids.length}:${hash.toString(16)}`;
};
const ids = (songs: readonly { readonly trackId: string }[]) => songs.map((song) => song.trackId);
const scored = (songs: readonly RankedRadioSong[]) =>
  songs.map((song) => `${song.trackId}=${song.score}`);

/**
 * Runs [steps] one step at a time over candidates whose reads are counted,
 * and gives the most reads one step made: the work it held the thread for.
 */
const mostReadsPerStep = <A>(steps: Generator<void, A>, counter: { reads: number }) => {
  let most = 0;
  for (;;) {
    counter.reads = 0;
    const next = steps.next();
    most = Math.max(most, counter.reads);
    if (next.done === true) return { value: next.value, most };
  }
};

/** [songs], each a copy that counts every property read into [counter]. */
const counted = (songs: readonly RankedRadioSong[], counter: { reads: number }) =>
  songs.map(
    (song) =>
      new Proxy(song, {
        get: (target, key, receiver) => {
          counter.reads++;
          return Reflect.get(target, key, receiver);
        },
      }),
  );

describe("the Magic Queue batch is the same as before slicing", () => {
  test("its completion picks the same songs and teaches the session the same", () => {
    const batch = completeMagicRadioBatch(session, seed, liked);
    assert.deepEqual(batch.trackIds, [
      // Recorded from the batch picked in one go, before #1448.
      "yt:s1",
      "1",
      "2",
      "yt:l0",
      "yt:s2",
      "3",
      "yt:l3",
      "4",
      "5",
      "yt:l6",
    ]);
    assert.equal(digest(batch.session.used), "610:2c145872");
    assert.equal(batch.session.batches, 4);
  });

  test("a faithful batch's Close fill picks the same songs", () => {
    const short = { ...session, used: [...session.used, ...ids(seed.slice(10))] };
    const batch = completeMagicRadioBatch(short, seed.slice(0, 12), [], () => ({ seed, liked }));
    assert.deepEqual(batch.trackIds, [
      "yt:s1",
      "yt:s2",
      "yt:s4",
      "yt:s5",
      "yt:s7",
      "yt:s8",
      "yt:l0",
      "yt:l3",
      "yt:l6",
      "yt:l9",
    ]);
  });

  test("a DJ session's first batch picks the same songs", () => {
    const first: MagicSession = {
      ...dj,
      batches: 0,
      djArtistSeeds: ["Artist 1", "Artist 2", "Artist 3"],
    };
    assert.deepEqual(completeMagicRadioBatch(first, seed, liked).trackIds, [
      "yt:s1",
      "1",
      "yt:l0",
      "2",
      "yt:s2",
      "yt:l3",
      "3",
      "4",
      "yt:l6",
    ]);
  });

  test("Artist variety keeps the same candidates in the same order", () => {
    const pools = djVarietyCandidates(dj, graph, { seed, liked }, 10);
    assert.equal(digest(ids(pools.seed)), "18:6cc7ba9f");
    assert.equal(digest(ids(pools.liked)), "0:811c9dc5");
    const medium = { ...dj, dj: { ...dj.dj!, variety: "medium" as const } };
    const near = djVarietyCandidates(medium, graph, { seed, liked }, 10);
    assert.equal(digest(ids(near.seed)), "68:f3ae2675");
    assert.equal(digest(ids(near.liked)), "6:2faab798");
  });

  test("New releases ranks the same", () => {
    assert.equal(digest(scored(djNewReleasesRanked(dj, seed, pages, NOW))), "3300:b909b70e");
  });

  test("the exclusions are the same", () => {
    const songs = [...seed, ...liked].flatMap((song) => song.song ?? []);
    assert.equal(digest([...magicRadioExclusions(session, songs)]), "611:b1e56d6a");
  });
});

/**
 * In one go, the batch's completion read its candidates 24,230 times in one
 * block, Artist variety 22,571, New releases 39,195 and mood 48,908 (the
 * 3,000-song seed). In slices, a step reads one candidate, held against a
 * batch's ten songs at most (the Close fill's recordings): 64 reads at worst.
 */
const MOST_READS_PER_STEP = 100;

describe("the Magic Queue batch's ranking runs a few candidates per step", () => {
  const counter = { reads: 0 };
  const countedSeed = counted(seed, counter);
  const countedLiked = counted(liked, counter);

  test("its completion", () => {
    const { value, most } = mostReadsPerStep(
      completeMagicRadioBatchSteps(session, countedSeed, countedLiked),
      counter,
    );
    assert.deepEqual(value.trackIds, completeMagicRadioBatch(session, seed, liked).trackIds);
    assert.ok(most <= MOST_READS_PER_STEP, `${most} reads in one step`);
  });

  test("its Close fill and a DJ session's first batch", () => {
    const short = { ...session, used: [...session.used, ...ids(seed.slice(10))] };
    const fill = mostReadsPerStep(
      completeMagicRadioBatchSteps(short, countedSeed.slice(0, 12), [], () => ({
        seed: countedSeed,
        liked: countedLiked,
      })),
      counter,
    );
    assert.equal(fill.value.trackIds.length, 10);
    assert.ok(fill.most <= MOST_READS_PER_STEP, `${fill.most} reads in one step`);
    const first = { ...dj, batches: 0, djArtistSeeds: ["Artist 1", "Artist 2", "Artist 3"] };
    const opening = mostReadsPerStep(
      completeMagicRadioBatchSteps(first, countedSeed, countedLiked),
      counter,
    );
    assert.equal(opening.value.trackIds.length, 9);
    assert.ok(opening.most <= MOST_READS_PER_STEP, `${opening.most} reads in one step`);
  });

  test("Artist variety", () => {
    const { value, most } = mostReadsPerStep(
      djVarietyCandidatesSteps(dj, graph, { seed: countedSeed, liked: countedLiked }, 10),
      counter,
    );
    assert.deepEqual(
      ids(value.seed),
      ids(djVarietyCandidates(dj, graph, { seed, liked }, 10).seed),
    );
    assert.ok(most <= MOST_READS_PER_STEP, `${most} reads in one step`);
  });

  test("New releases and mood", () => {
    const releases = mostReadsPerStep(
      djNewReleasesRankedSteps(dj, countedSeed, pages, NOW),
      counter,
    );
    assert.deepEqual(scored(releases.value), scored(djNewReleasesRanked(dj, seed, pages, NOW)));
    assert.ok(releases.most <= MOST_READS_PER_STEP, `${releases.most} reads in one step`);
    const mood = mostReadsPerStep(
      djMoodFilteredSteps(countedSeed, "energetic", features, genres, libraryFeatures),
      counter,
    );
    const plain = djMoodFiltered(seed, "energetic", features, genres, libraryFeatures);
    assert.deepEqual(ids(mood.value.matched), ids(plain.matched));
    assert.deepEqual(ids(mood.value.unknown), ids(plain.unknown));
    assert.ok(plain.matched.length > 0 && plain.unknown.length > 0);
    assert.ok(mood.most <= MOST_READS_PER_STEP, `${mood.most} reads in one step`);
    const moods = mostReadsPerStep(
      djMoodFilteredSteps(countedSeed, ["relaxing", "upbeat"], features, genres, libraryFeatures),
      counter,
    );
    const plainMoods = djMoodFiltered(
      seed,
      ["relaxing", "upbeat"],
      features,
      genres,
      libraryFeatures,
    );
    assert.deepEqual(ids(moods.value.matched), ids(plainMoods.matched));
    assert.ok(moods.most <= MOST_READS_PER_STEP, `${moods.most} reads in one step`);
  });

  test("the exclusions, over a radio's songs", () => {
    const songs = [...seed, ...liked].flatMap((song) => song.song ?? []);
    const counting = new Proxy(songs, {
      get: (target, key, receiver) => {
        counter.reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const { value, most } = mostReadsPerStep(magicRadioExclusionsSteps(session, counting), counter);
    assert.deepEqual([...value], [...magicRadioExclusions(session, songs)]);
    assert.ok(most <= MOST_READS_PER_STEP, `${most} reads in one step`);
  });

  test("the plain functions finish the same steps", () => {
    assert.deepEqual(
      finishSteps(completeMagicRadioBatchSteps(session, seed, liked)).trackIds,
      completeMagicRadioBatch(session, seed, liked).trackIds,
    );
  });
});

describe("the Library's genre profiles a batch ranks with", () => {
  const artists = Array.from({ length: 1200 }, (_, i) => ({ id: i, name: `Artist ${i}` }));
  const songs = Array.from({ length: LIBRARY }, (_, i) => ({
    artistIds: [i % 1200, (i * 7) % 1200],
    genre: i % 3 === 0 ? "Rock; Indie" : i % 3 === 1 ? "Pop" : null,
  }));
  const names = [...artists.map((artist) => artist.name), "Nobody", "artist 7"];

  test("are built a song or an artist per step, and give every artist the same profile", () => {
    const counter = { reads: 0 };
    const counting = <A extends object>(values: readonly A[]) =>
      values.map(
        (value) =>
          new Proxy(value, {
            get: (target, key, receiver) => {
              counter.reads++;
              return Reflect.get(target, key, receiver);
            },
          }),
      );
    const { value: profileOf, most } = mostReadsPerStep(
      libraryGenreProfilesSteps({ artists: counting(artists), songs: counting(songs) }),
      counter,
    );
    assert.ok(most <= MOST_READS_PER_STEP, `${most} reads in one step`);
    const eager = finishSteps(libraryMixProfilesSteps({ artists, songs })).profileOf;
    const plain = libraryGenreProfiles({ artists, songs });
    for (const name of names) {
      assert.deepEqual(profileOf(name), eager(name), name);
      assert.deepEqual(plain(name), eager(name), name);
    }
  });
});

describe("a batch's radio ranking (#1448)", () => {
  const radio = Array.from({ length: 2000 }, (_, i) => stream(i, "c").song!);
  const library = seed.filter((song) => song.source === "library");
  // Disliked by video and by Track id, as the app keeps them.
  const disliked = new Set([
    ...Array.from({ length: 150 }, (_, i) => ytTrackId(`c${i * 5}`)),
    ...Array.from({ length: 150 }, (_, i) => String(i * 11)),
  ]);
  const ranking = (songs: readonly YtAlbumSong[]) =>
    [
      { artists: ["Artist 1"] },
      {
        pages: [{ id: "song:c", artists: ["Artist 1"], songs }],
        graph,
        library,
        disliked,
        popularityOf: () => 0.5,
      },
      { libraryFallback: true, exclude: new Set(session.used) },
    ] as const;

  test("ranks the same songs in the same order", () => {
    const ranked = rankRadioSongs(...ranking(radio));
    // Recorded from the ranking before its dislike filter ran a candidate per step.
    assert.equal(digest(ids(ranked)), "4519:2d9b944d");
    assert.ok(ranked.every((song) => !disliked.has(song.trackId)));
  });

  test("leaves out the disliked a candidate per step", () => {
    const counter = { reads: 0 };
    const counting = radio.map(
      (song) =>
        new Proxy(song, {
          get: (target, key, receiver) => {
            counter.reads++;
            return Reflect.get(target, key, receiver);
          },
        }),
    );
    const { value, most } = mostReadsPerStep(rankRadioSongsSteps(...ranking(counting)), counter);
    assert.ok(most <= MOST_READS_PER_STEP, `${most} reads in one step`);
    assert.deepEqual(ids(value), ids(rankRadioSongs(...ranking(radio))));
  });

  test("keeps the songs that can play, offline too, a song per step", () => {
    const ranked = rankRadioSongs(...ranking(radio));
    const cachedVideos = new Set(Array.from({ length: 400 }, (_, i) => `c${i * 3}`));
    for (const where of [
      { online: true, ytMusic: true, cachedVideos: null },
      { online: false, ytMusic: true, cachedVideos },
      { online: false, ytMusic: true, cachedVideos: null },
      { online: true, ytMusic: false, cachedVideos },
    ]) {
      const counter = { reads: 0 };
      const { value, most } = mostReadsPerStep(
        availableMagicSongsSteps(session, counted(ranked, counter), where),
        counter,
      );
      assert.ok(most <= MOST_READS_PER_STEP, `${most} reads in one step`);
      const plain = availableMagicSongs(session, ranked, where);
      assert.deepEqual(ids(value), ids(plain));
      assert.deepEqual(
        ids(plain),
        ids(
          ranked.filter(
            (song) =>
              song.source === "library" ||
              (where.ytMusic &&
                (where.online ||
                  (song.song !== null && where.cachedVideos?.has(song.song.videoId) === true))),
          ),
        ),
      );
    }
  });
});
