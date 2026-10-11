/**
 * SYNTHETIC. Invented albums and songs for the Design preview, so the catalog
 * can be judged before the scanner (#5) exists. Delete with the preview.
 */
import type { AlbumSummary } from "@/catalog/AlbumTile";
import type { TrackState, TrackSummary } from "@/catalog/TrackRow";

const ARTISTS = [
  "Nils Aarvold",
  "The Low Meridian",
  "Ilse Brandt Trio",
  "Ochre Field",
  "Marta Quell",
  "A Northern Room",
  "Sato & Lindqvist",
  "Hollow Pines",
  "Élodie Vasse",
  "Grey Harbour",
  "Tomas Riel",
  "Unmade Bed",
  "Kasimir Ode",
  "Paper Lanterns",
  "Yara Solheim",
  "Westward Static",
  "Dunmore Quartet",
  "Fen",
  "Ciaran Holt",
  "Zelda Mäkinen",
];

const WORDS = [
  "Still",
  "Water",
  "Late",
  "Light",
  "Northern",
  "Song",
  "Glass",
  "Harbour",
  "Silent",
  "Rooms",
  "Distance",
  "Winter",
  "Ash",
  "Tide",
  "Hours",
  "Field",
  "Echo",
  "Lantern",
  "Morning",
  "Salt",
  "Orbit",
  "Quiet",
  "Valley",
  "Ember",
  "Drift",
  "Kestrel",
  "Iris",
  "Under",
  "Yellow",
  "Open",
  "Zero",
  "Ninefold",
  "Bright",
  "Paper",
  "Umber",
  "Juniper",
];

/** Muted, photographic fields standing in for cover art. */
const TINTS = [
  "#5B6B73",
  "#8A7B66",
  "#3F5A55",
  "#9AA39B",
  "#6E5A4E",
  "#2F3B44",
  "#A49A86",
  "#4E6170",
  "#7D8B7A",
  "#55474A",
  "#B3B8B0",
  "#38504D",
];

const random = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

const pick = <T>(items: readonly T[], next: () => number): T =>
  items[Math.floor(next() * items.length)] as T;

const title = (next: () => number): string =>
  Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(WORDS, next)).join(" ");

/** Sort and index key: articles and accents ignored (Core owns the real rule, #10). */
export const sortKey = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(the|a|an)\s+/i, "")
    .toUpperCase();

export const indexLetter = (text: string): string => {
  const first = sortKey(text)[0] ?? "#";
  return first >= "A" && first <= "Z" ? first : "#";
};

/**
 * Sorted copy by title. Hermes has no `Array#toSorted`, so this copies, then sorts.
 */
const byTitle = <T extends { title: string }>(items: T[]): T[] =>
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
  [...items].sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title)));

const next = random(42);

export const SYNTHETIC_ALBUMS: readonly AlbumSummary[] = byTitle(
  Array.from({ length: 48 }, (_, i) => {
    const trackCount = 6 + Math.floor(next() * 9);
    return {
      id: `album-${i}`,
      title: title(next),
      albumArtist: pick(ARTISTS, next),
      year: 1968 + Math.floor(next() * 57),
      trackCount,
      durationMs: trackCount * (150_000 + Math.floor(next() * 180_000)),
      tint: pick(TINTS, next),
    };
  }),
);

export type SyntheticTrack = { track: TrackSummary; state: TrackState; favorite: boolean };

export const SYNTHETIC_TRACKS: readonly SyntheticTrack[] = byTitle(
  SYNTHETIC_ALBUMS.flatMap((album) =>
    Array.from({ length: album.trackCount }, (_, n) => ({
      id: `${album.id}-${n + 1}`,
      title: title(next),
      artist: album.albumArtist,
      durationMs: 120_000 + Math.floor(next() * 300_000),
      trackNumber: n + 1,
      tint: album.tint,
    })),
  ),
).map((track, i) => ({
  track,
  state: i === 2 ? "playing" : i === 7 ? "missing" : undefined,
  favorite: i % 9 === 4,
}));

/** First index of each letter in an ordered list, for the A–Z spine. */
export const letterIndex = (titles: readonly string[]): Map<string, number> => {
  const index = new Map<string, number>();
  titles.forEach((text, i) => {
    const letter = indexLetter(text);
    if (!index.has(letter)) index.set(letter, i);
  });
  return index;
};
