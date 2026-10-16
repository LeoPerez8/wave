/**
 * What Search's index costs to build, once as the app built it before #306
 * (one `createSearchIndex` over every source, again after any Library or
 * playlist change) and once through Core's `createSearchCatalog` (sources
 * prepared on their own, in bounded steps, a changed source alone again).
 *
 * Run from packages/core with plain Node (no dependencies):
 *
 *   node bench/searchCatalog.ts [songs]
 *
 * A synthetic Library: [songs] songs (50,000 by default), one album per ten
 * songs, one artist per 25, 300 genres, 200 playlists. These are desktop
 * numbers for the JavaScript work only (no SQLite reads); a phone running
 * Hermes is several times slower.
 */
import { createSearchCatalog, createSearchIndex, type SearchEntry } from "../src/index.ts";

const SONGS = Number(process.argv[2] ?? 50_000);
const STEP_ENTRIES = 250;

const syllables = ["la", "lo", "ve", "ri", "ka", "mo", "ne", "sa", "ti", "be", "yo", "cé"];
let seed = 7;
const pick = (): string => {
  seed = (seed * 16_807) % 2_147_483_647;
  return syllables[seed % syllables.length]!;
};
const name = (words: number): string =>
  Array.from({ length: words }, () => pick() + pick()).join(" ");

interface Row {
  readonly name: string;
  readonly also?: readonly string[];
}
const rows = (count: number, words: number, also = 0): Row[] =>
  Array.from({ length: count }, () => ({
    name: name(words),
    ...(also === 0 ? {} : { also: Array.from({ length: also }, () => name(2)) }),
  }));

const library = {
  artists: rows(Math.ceil(SONGS / 25), 2),
  albums: rows(Math.ceil(SONGS / 10), 3, 1),
  songs: rows(SONGS, 3, 2),
  playlists: rows(200, 2),
  genres: rows(300, 1),
};
type Source = keyof typeof library;
const SOURCES: readonly Source[] = ["artists", "albums", "songs", "playlists", "genres"];
const KIND: Record<Source, SearchEntry["kind"]> = {
  artists: "artist",
  albums: "album",
  songs: "song",
  playlists: "playlist",
  genres: "genre",
};
const entryOf =
  (source: Source) =>
  (row: Row): SearchEntry => ({ kind: KIND[source], name: row.name, also: row.also });

const time = (run: () => void): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};
const ms = (value: number): string => `${value.toFixed(1)} ms`;

// Warm the JIT a little, as a running app would be.
createSearchIndex(library.genres.map(entryOf("genres")));

const everything = (): SearchEntry[] =>
  SOURCES.flatMap((source) => library[source].map(entryOf(source)));
const whole = time(() => createSearchIndex(everything()));

const catalog = createSearchCatalog<Source, SearchEntry>(SOURCES);
for (const source of SOURCES) catalog.update(source, library[source], entryOf(source));
/** Works the catalog until it is done; returns each step's time. */
const drain = (): number[] => {
  const times: number[] = [];
  let more = true;
  while (more) {
    const started = performance.now();
    more = catalog.work(STEP_ENTRIES);
    times.push(performance.now() - started);
  }
  return times;
};
const stepTimes = drain();
const first = stepTimes.reduce((sum, step) => sum + step, 0);

const rePrepare = (
  source: Source,
  next: Row[],
): { total: number; longest: number; steps: number } => {
  library[source] = next;
  catalog.update(source, next, entryOf(source));
  const times = drain();
  return {
    total: times.reduce((a, b) => a + b, 0),
    longest: Math.max(...times),
    steps: times.length,
  };
};
const playlistEdit = rePrepare("playlists", [...library.playlists, { name: "Imported mix" }]);
const unchanged = time(() => {
  for (const source of SOURCES) catalog.update(source, library[source], entryOf(source));
  catalog.work(STEP_ENTRIES);
});
const songsChange = rePrepare("songs", [...library.songs.slice(1), { name: "Downloaded song" }]);

const index = catalog.index()!;
const typing = time(() => {
  for (const query of ["l", "lo", "lov", "love", "love s", "love sa"])
    index.search(query, { limit: 200 });
});

console.log(
  `Search index, ${SONGS} songs, ${catalog.stats().entries} entries (desktop, Node ${process.version})`,
);
console.log("");
console.log("| Work | Before #306 | #306 |");
console.log("| --- | --- | --- |");
console.log(
  `| First build | ${ms(whole)} in one task | ${ms(first)} in ${stepTimes.length} steps, longest ${ms(Math.max(...stepTimes))} |`,
);
console.log(
  `| A playlist edit or import batch | ${ms(whole)} (whole rebuild) | ${ms(playlistEdit.total)}, the playlists alone |`,
);
console.log(`| Sources read again unchanged | ${ms(whole)} (whole rebuild) | ${ms(unchanged)} |`);
console.log(
  `| A song download or edit | ${ms(whole)} (whole rebuild) | ${ms(songsChange.total)} in ${songsChange.steps} steps, longest ${ms(songsChange.longest)} |`,
);
console.log(`| Typing "love sa" (6 searches, 200 a kind) | same | ${ms(typing)} |`);
