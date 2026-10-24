/**
 * Drawing the songs of an album or a playlist whose radios a recommendation
 * reads (docs/spec.md, Magic Queue): a few by different artists, leaning
 * towards the most played, or the most recently added, and changing from one
 * draw to the next.
 */
import { pickWeighted, playsWeight, type RandomSource } from "./weightedPick.ts";

/** A song of the list a draw picks from. */
export interface SeedSong {
  readonly id: string;
  /** Its primary artist, by name: two songs by the same one (whatever the case) never share a draw. */
  readonly artist: string;
  /** Its counted plays, which `weight: "plays"` leans towards; none count as 0. */
  readonly plays?: number;
  /** When it joined the list, which `weight: "added"` leans towards; none counts as the oldest. */
  readonly addedAt?: number;
}

/** How many seed songs a draw gives unless asked otherwise. */
export const SEED_SONG_DRAW = 3;

/**
 * Up to [count] of [songs], each by a different artist, picked at random from
 * [random]: those with more plays more often (`weight: "plays"`, as
 * `playsWeight` weighs them), or those added more recently (`weight: "added"`).
 * Songs in [recent] (the earlier draws' songs, oldest first) are left out
 * while songs by other artists remain; a slot no other song can fill gets
 * the least recently drawn one. In the order they were picked.
 */
export const drawSeedSongs = <S extends SeedSong>(
  songs: readonly S[],
  {
    count = SEED_SONG_DRAW,
    weight,
    recent = [],
    random,
  }: {
    readonly count?: number;
    readonly weight: "plays" | "added";
    readonly recent?: readonly string[];
    readonly random: RandomSource;
  },
): S[] => {
  const unique = [...new Map(songs.map((song) => [song.id, song])).values()];
  const weightOf = weigh(unique, weight);
  const artistOf = (song: SeedSong) => song.artist.trim().toLowerCase();
  const lastDrawn = new Map(recent.map((id, index) => [id, index]));
  const drawn: S[] = [];
  const taken = new Set<string>();
  let left = unique.filter((song) => !lastDrawn.has(song.id));
  while (drawn.length < count && left.length > 0) {
    const [picked] = pickWeighted(left, 1, (song) => weightOf.get(song.id) ?? 1, random);
    if (picked === undefined) break;
    drawn.push(picked);
    taken.add(artistOf(picked));
    left = left.filter((song) => !taken.has(artistOf(song)));
  }
  const stale = unique
    .filter((song) => lastDrawn.has(song.id))
    .toSorted((a, b) => lastDrawn.get(a.id)! - lastDrawn.get(b.id)!);
  for (const song of stale) {
    if (drawn.length >= count) break;
    if (taken.has(artistOf(song))) continue;
    drawn.push(song);
    taken.add(artistOf(song));
  }
  return drawn;
};

/**
 * Each song's weight in a draw, by id. By addition, a song weighs 1 / (n + 1),
 * n the number of distinct dates newer than its own: songs added together
 * weigh alike, and the newest weigh twice the next, three times the third.
 */
const weigh = (songs: readonly SeedSong[], weight: "plays" | "added"): Map<string, number> => {
  if (weight === "plays")
    return new Map(songs.map((song) => [song.id, playsWeight(song.plays ?? 0)]));
  const dates = [...new Set(songs.map((song) => song.addedAt ?? -Infinity))].toSorted(
    (a, b) => b - a,
  );
  const rank = new Map(dates.map((date, index) => [date, index]));
  return new Map(
    songs.map((song) => [song.id, 1 / ((rank.get(song.addedAt ?? -Infinity) ?? 0) + 1)]),
  );
};
