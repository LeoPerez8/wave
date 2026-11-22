/**
 * DJ's opening work over a 3,000-song Library (#1437), timed in Node: Genre
 * mixes' families, the opening grid, and the reopened selection, each as
 * one synchronous run and as the longest step slice the app would take.
 *
 *   pnpm --filter @wave/mobile bench:dj-opening
 */
import {
  djGrid,
  djGridCandidates,
  djReopened,
  genreMixDjCandidates,
  genreMixDjCandidatesSteps,
  djGridCandidatesSteps,
  djReopenedSteps,
  type DjAlbum,
  type DjTile,
  type TasteProfile,
  type ArtistGraph,
  type GenreMixLibrary,
} from "@wave/core";

const SONGS = 3000;
const ARTISTS = 900;
const ALBUMS = 1500;
const TAGS = [
  "Rock",
  "Indie Rock",
  "Pop",
  "Hip Hop",
  "Rap",
  "Jazz",
  "Electronic",
  "House",
  "Techno",
  "Metal",
  "Metalcore; Rock",
  "Punk",
  "Soul",
  "R&B",
  "Funk",
  "Country",
  "Folk",
  "Blues",
  "Reggae",
  "Classical",
  "MPB",
  "Samba",
  "Bossa Nova",
  "Ambient",
];

let seed = 1437;
const random = (): number => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const artists = Array.from({ length: ARTISTS }, (_, i) => ({ id: i + 1, name: `Artist ${i + 1}` }));
const songs = Array.from({ length: SONGS }, (_, i) => {
  const artist = artists[i % ARTISTS]!;
  return {
    id: i + 1,
    title: `Song ${i + 1}`,
    artist: artist.name,
    artistIds: [artist.id],
    durationMs: 200_000,
    addedAt: i,
    genre: TAGS[artist.id % TAGS.length]!,
  };
});
const plays = songs.filter((_, i) => i % 3 === 0).map((song) => ({ id: song.id, countedPlays: 1 + (song.id % 7) }));
const edges = new Map<string, Map<string, number>>();
const names = new Map<string, string>();
for (let i = 0; i < ARTISTS + 600; i++) {
  const key = `artist ${i + 1}`;
  names.set(key, `Artist ${i + 1}`);
  const of = new Map<string, number>();
  for (let n = 0; n < 12; n++) of.set(`artist ${1 + Math.floor(random() * (ARTISTS + 600))}`, random());
  edges.set(key, of);
}
const graph: ArtistGraph = { edges, names };
const taste: TasteProfile = {
  at: 0,
  songs: new Map(),
  artists: new Map(artists.map((artist) => [artist.name.toLowerCase(), random()])),
  genres: new Map(
    ["rock", "pop", "hip hop", "jazz", "electronic", "metal", "soul", "country", "folk"].map((g) => [
      g,
      random(),
    ]),
  ),
};
const albums: DjAlbum[] = Array.from({ length: ALBUMS }, (_, i) => ({
  title: `Album ${i + 1}`,
  artist: artists[i % ARTISTS]!.name,
  libraryId: i + 1,
  cover: null,
}));
const library: GenreMixLibrary = { artists, songs, plays, graph };

const time = <A>(label: string, run: () => A): A => {
  const start = performance.now();
  const value = run();
  console.log(`${label.padEnd(36)} ${(performance.now() - start).toFixed(1).padStart(8)} ms`);
  return value;
};

/** Runs [steps] in 6 ms slices, as the app's `runSteps` does; returns the longest. */
const sliced = <A>(label: string, steps: Generator<void, A>): A => {
  let longest = 0;
  let slices = 0;
  for (;;) {
    const start = performance.now();
    let next: IteratorResult<void, A>;
    let count = 0;
    do {
      next = steps.next();
      count++;
    } while (!next.done && count < 512 && performance.now() - start < 6);
    longest = Math.max(longest, performance.now() - start);
    slices++;
    if (next.done) {
      console.log(
        `${label.padEnd(36)} ${slices.toString().padStart(5)} slices, longest ${longest.toFixed(1)} ms`,
      );
      return next.value;
    }
  }
};

for (let round = 0; round < 2; round++) {
  console.log(`round ${round + 1}`);
  const families = time("genreMixDjCandidates", () => genreMixDjCandidates(library));
  sliced("genreMixDjCandidatesSteps", genreMixDjCandidatesSteps(library));
  const sources = { artists, taste, graph, genreCandidates: families, albums };
  time("djGridCandidates", () => djGridCandidates(sources));
  const grid: DjTile[] = time("djGrid", () => djGrid(sources));
  sliced("djGridCandidatesSteps (full)", djGridCandidatesSteps(sources));
  sliced("djGridCandidatesSteps (opening page)", djGridCandidatesSteps(sources, 24));
  const remembered = { grid, remembered: grid.slice(0, 3), artists, albums, genreCandidates: families, taste };
  time("djReopened", () => djReopened(remembered));
  sliced("djReopenedSteps", djReopenedSteps(remembered));
}
