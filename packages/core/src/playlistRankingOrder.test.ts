import assert from "node:assert/strict";
import { test } from "node:test";
import {
  playlistOfferGone,
  playlistOfferGoneSteps,
  playlistRecommendations,
  playlistRecommendationsSteps,
  samePlaylistTracks,
  samePlaylistTracksSteps,
  type PlaylistRecommendationSources,
  type PlaylistRecommendationTrack,
  type RadioRankingPage,
  type YtAlbumSong,
} from "./index.ts";

const ARTISTS = ["Radiohead", "Portishead", "Massive Attack", "Björk", "Air", "Moby", "Slowdive"];
const GENRES = ["Alternative Rock", "Trip Hop", "Electronic", "Shoegaze", null];

/** A Library in the shape the phone's has: shared artists, collaborations, gaps in the tags. */
const libraryOf = (size: number): PlaylistRecommendationTrack[] =>
  Array.from({ length: size }, (_, index) => {
    const artist = ARTISTS[index % ARTISTS.length]!;
    return {
      id: `lib${index}`,
      source: "library" as const,
      videoId: index % 5 === 0 ? `vid${index}` : "",
      title: `Song ${index}`,
      artists: index % 11 === 0 ? [artist, ARTISTS[(index + 2) % ARTISTS.length]!] : [artist],
      album: `Album ${index % 9}`,
      albumId: null,
      durationMs: 180000 + index * 1000,
      artworkUrl: null,
      explicit: false,
      genre: GENRES[index % GENRES.length]!,
      available: index % 13 !== 0,
      favorite: index % 17 === 0,
      downloaded: index % 19 === 0,
    };
  });

const stream = (videoId: string, artist: string, title = videoId): YtAlbumSong => ({
  videoId,
  title,
  artists: [artist],
  album: null,
  albumId: null,
  durationMs: 200000,
  artworkUrl: null,
  explicit: false,
});

const entry = (
  id: string,
  artist: string,
  genre: string | null,
  album: string | null = null,
): PlaylistRecommendationTrack => ({
  ...stream(id, artist),
  id,
  source: "stream",
  genre,
  album,
});

/** A radio of new songs with some of the Library's among them, by title and length. */
const radioOf = (
  id: string,
  library: readonly PlaylistRecommendationTrack[],
  artist: string,
  from: number,
): RadioRankingPage => ({
  id,
  artists: [artist],
  songs: Array.from({ length: 24 }, (_, position) => {
    const known = library[from + position * 3];
    return position % 4 === 0 && known !== undefined
      ? {
          ...stream(`match${from}-${position}`, known.artists[0]!, known.title),
          durationMs: known.durationMs,
        }
      : stream(`new${from}-${position}`, ARTISTS[(from + position) % ARTISTS.length]!);
  }),
});

const shared = (library: readonly PlaylistRecommendationTrack[]) => ({
  library,
  graph: null,
  online: true,
  feedback: [
    { track: entry("liked", "Air", "Electronic"), value: 1 as const },
    { track: entry("new0-2", "Massive Attack", "Trip Hop"), value: -1 as const },
  ],
  exclude: [entry("new0-5", "Slowdive", null), library[8]!],
  favoriteVideos: new Set(["new40-3"]),
});

const rock = (library: readonly PlaylistRecommendationTrack[]) => ({
  playlist: [
    library[0]!,
    library[7]!,
    library[15]!,
    entry("own1", "Radiohead", "Alternative Rock", "Album 3"),
    entry("own2", "Portishead", null, "Album 4"),
  ],
  sources: {
    ...shared(library),
    pages: [radioOf("one", library, "Radiohead", 0), radioOf("two", library, "Portishead", 40)],
    seeds: [library[0]!, entry("own2", "Portishead", null)],
  } satisfies PlaylistRecommendationSources,
});

/** Another playlist on the same Library: only its own songs may lean its ranking. */
const electronic = (library: readonly PlaylistRecommendationTrack[]) => ({
  playlist: [
    library[4]!,
    entry("own3", "Air", "Electronic", "Album 5"),
    entry("own4", "Air", "Electronic"),
    entry("own5", "Moby", "Electronic"),
    entry("own6", "Radiohead", "Electronic"),
  ],
  sources: {
    ...shared(library),
    pages: [radioOf("three", library, "Air", 20)],
    seeds: [entry("own3", "Air", "Electronic")],
  } satisfies PlaylistRecommendationSources,
});

const ranked = ({
  playlist,
  sources,
}: {
  playlist: readonly PlaylistRecommendationTrack[];
  sources: PlaylistRecommendationSources;
}) =>
  playlistRecommendations(playlist, sources, 20).map(
    ({ track, score }) => `${track.id} ${score.toFixed(4)}`,
  );

/** What the code ranked before Library indexes were reused, written down then. */
const ROCK = [
  "yt:new40-3 10.6590",
  "lib85 8.8974",
  "lib119 8.1149",
  "lib114 7.2494",
  "lib51 6.4125",
  "lib76 5.1779",
  "lib40 11.8974",
  "yt:new40-2 11.4482",
  "yt:new40-1 10.1770",
  "yt:new0-3 9.0275",
  "yt:match40-4 8.4780",
  "yt:new40-6 8.2063",
  "lib12 7.7753",
  "yt:new0-11 6.7182",
];
const ELECTRONIC = [
  "lib102 9.2200",
  "lib95 7.7200",
  "lib68 5.3462",
  "yt:new20-1 12.1523",
  "lib20 10.0000",
  "yt:new20-2 9.8889",
  "yt:new20-6 9.4983",
  "yt:new20-3 8.6683",
  "lib56 8.0455",
  "yt:new20-7 7.4986",
  "yt:new20-9 6.8187",
  "yt:new20-11 6.3175",
  "yt:new20-10 5.9760",
  "yt:new20-18 5.1270",
];

const stepsOf = ({
  playlist,
  sources,
}: {
  playlist: readonly PlaylistRecommendationTrack[];
  sources: PlaylistRecommendationSources;
}) => {
  const steps = playlistRecommendationsSteps(playlist, sources, 20);
  let count = 0;
  while (steps.next().done !== true) count++;
  return count;
};

test("the same input ranks in the same order, on a Library ranked before and on a new one", () => {
  const library = libraryOf(120);
  assert.deepEqual(ranked(rock(library)), ROCK);
  assert.deepEqual(ranked(rock(library)), ROCK);
  assert.deepEqual(ranked(rock(libraryOf(120))), ROCK);
});

test("two playlists on one Library rank as if each were alone", () => {
  const library = libraryOf(120);
  assert.deepEqual(ranked(rock(library)), ROCK);
  assert.deepEqual(ranked(electronic(library)), ELECTRONIC);
  assert.deepEqual(ranked(rock(library)), ROCK);
  assert.deepEqual(ranked(electronic(libraryOf(120))), ELECTRONIC);
});

test("a ranking cancelled while indexing the Library leaves the next one the same order", () => {
  const library = libraryOf(120);
  const cancelled = playlistRecommendationsSteps(rock(library).playlist, rock(library).sources, 20);
  for (let step = 0; step < 50; step++) cancelled.next();
  cancelled.return([]);
  assert.deepEqual(ranked(rock(library)), ROCK);
});

test("the Library's indexes are built once until the Library changes", () => {
  const library = libraryOf(600);
  const first = stepsOf(rock(library));
  const second = stepsOf(rock(library));
  // What's left is this ranking's own: here a third of the Library is by the seeds' artists.
  assert.ok(second * 2 < first, `${second} steps again after ${first}`);
  // Another playlist on the same Library, and a radio of its own, reuse them too.
  assert.ok(stepsOf(electronic(library)) * 2 < first);
  // A star or a scan makes a new Library array: its indexes are built anew.
  assert.equal(stepsOf(rock(libraryOf(600))), first);
});

test("telling which offers are gone reuses the Library's indexes and keeps its answers", () => {
  const library = libraryOf(600);
  const { playlist, sources } = rock(library);
  const steps = playlistOfferGoneSteps(playlist, sources);
  let cold = 0;
  while (steps.next().done !== true) cold++;
  const again = playlistOfferGoneSteps(playlist, sources);
  let warm = 0;
  while (again.next().done !== true) warm++;
  assert.ok(warm * 4 < cold, `${warm} steps again after ${cold}`);
  const gone = playlistOfferGone(playlist, sources);
  assert.equal(gone(library[0]!), true, "the playlist holds it");
  assert.equal(gone(library[13]!), true, "its file is gone");
  assert.equal(gone(library[14]!), false);
  assert.equal(gone(entry("elsewhere", "Air", null)), false);
});

test("two reads of a Library hold the same tracks until a field of one differs", () => {
  const library = libraryOf(30);
  assert.equal(samePlaylistTracks(library, libraryOf(30)), true);
  assert.equal(samePlaylistTracks(library, libraryOf(29)), false);
  const changed = (index: number, fields: Partial<PlaylistRecommendationTrack>) =>
    libraryOf(30).map((track, at) => (at === index ? { ...track, ...fields } : track));
  assert.equal(samePlaylistTracks(library, changed(4, { title: "Retitled" })), false);
  assert.equal(samePlaylistTracks(library, changed(4, { favorite: true })), false);
  assert.equal(samePlaylistTracks(library, changed(4, { artists: ["Someone Else"] })), false);
  assert.equal(samePlaylistTracks(library, changed(4, { genres: ["Rock"] })), false);
  const reordered = libraryOf(30).toReversed();
  assert.equal(samePlaylistTracks(library, reordered), false, "ranking ties follow the order");
  const steps = samePlaylistTracksSteps(library, libraryOf(30));
  let count = 0;
  while (steps.next().done !== true) count++;
  assert.ok(count >= 30, "a long Library compares across turns");
});

test("picking offers reads each one taken once, however many candidates follow it", () => {
  const readsOfPicked = (candidates: number) => {
    const reads = new Map<string, number>();
    const counted = (track: PlaylistRecommendationTrack) => {
      const { title, ...rest } = track;
      return Object.defineProperty(rest, "title", {
        enumerable: true,
        get: () => {
          reads.set(track.id, (reads.get(track.id) ?? 0) + 1);
          return title;
        },
      }) as PlaylistRecommendationTrack;
    };
    // One artist: its cap fills at two offers, and every candidate after them is checked and left.
    const library = Array.from({ length: candidates }, (_, index) =>
      counted({
        ...entry(`lib${index}`, "Air", "Electronic"),
        title: `Song ${index}`,
        source: "library",
        videoId: "",
      }),
    );
    const input = { playlist: [entry("own", "Air", "Electronic")], sources: { library, graph: null } };
    const picked = playlistRecommendations(input.playlist, input.sources, 20);
    assert.equal(picked.length, 2);
    // The Library's indexes stand from here: what's read now is this ranking's own.
    reads.clear();
    assert.deepEqual(
      playlistRecommendations(input.playlist, input.sources, 20).map(({ track }) => track.id),
      picked.map(({ track }) => track.id),
    );
    return picked.map(({ track }) => reads.get(track.id));
  };
  assert.deepEqual(readsOfPicked(300), readsOfPicked(30));
});
