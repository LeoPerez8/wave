/**
 * Artist credits: the artists a credit as tagged ("Ariana Grande, Doja Cat")
 * names, so a collaboration belongs to each of them.
 *
 * - "feat." / "ft." / "featuring" (bracketed or not) always separate artists.
 * - `,` `·` `;` `/` "with" " x " "&" and "and" separate them too, unless that
 *   part of the credit is an artist in the Library: a known whole credit, or
 *   the part of one before a featured credit ("Earth, Wind & Fire", "AC/DC",
 *   "Tyler, The Creator" from "Tyler, The Creator feat. Kali Uchis"), none of
 *   whose names is credited on its own anywhere. So a collaboration's own credit ("Ariana Grande, Doja Cat")
 *   keeps it whole until one of its artists has a song credited to them alone
 *   (or featuring someone).
 */
import { UNKNOWN_ARTIST, identityKey } from "./library.ts";

/** A bracketed credit, "(feat. X)" or "[with X]": the brackets go, the credit stays. */
const BRACKETED_CREDIT = /[([]\s*\b((?:feat|ft)\b\.?|featuring\b|with\b)([^)\]]*)[)\]]/giu;

/** Words that always introduce another artist: "feat." / "ft." (dot optional), "featuring". */
const FEATURING = /\s*\b(?:(?:feat|ft)\b\.?|featuring\b)\s*/giu;

/**
 * Marks that separate artists unless the Library knows the whole name, kept
 * by `split` ("Lil Nas X x Billy Ray Cyrus" splits on the last x).
 */
const SEPARATOR = /(\s*[,;·/&]\s*|\s*\bwith\b\s*|\s+and\s+|\s+x\s+(?!x\s))/iu;

const tidy = (name: string): string => name.replace(/\s+/g, " ").trim();

/** The parts of [credit] between featured credits, which always split. */
const segments = (credit: string): string[] =>
  credit.replace(BRACKETED_CREDIT, " $1$2").split(FEATURING);

/** A segment's names and the marks between them: `[name, mark, name, …]`. */
const pieces = (segment: string): string[] => segment.split(SEPARATOR);

/**
 * Splits credits with the Library's whole credits ([knownCredits]) in mind;
 * build one per Library and reuse it.
 */
export const creditSplitter = (knownCredits: Iterable<string>): ((credit: string) => string[]) => {
  const known = new Set<string>();
  // Names credited on their own somewhere: a part between featured credits with no other mark.
  const standing = new Set<string>();
  for (const credit of knownCredits) {
    known.add(identityKey(credit));
    const parts = segments(credit);
    // The part before a featured credit is the main artist's credit as written.
    if (parts.length > 1) known.add(identityKey(tidy(parts[0] ?? "")));
    for (const segment of parts) {
      const name = tidy(segment);
      if (name !== "" && pieces(segment).length === 1) standing.add(identityKey(name));
    }
  }

  /** The names of [segment], where a run of them the Library knows as one artist stays whole. */
  const namesOf = (segment: string): string[] => {
    const parts = pieces(segment);
    const names = parts.filter((_, i) => i % 2 === 0).map(tidy);
    const result: string[] = [];
    let first = 0;
    while (first < names.length) {
      let last = names.length - 1;
      for (; last > first; last--) {
        const whole = tidy(parts.slice(2 * first, 2 * last + 1).join(""));
        const isAnArtist =
          known.has(identityKey(whole)) &&
          !names.slice(first, last + 1).some((name) => standing.has(identityKey(name)));
        if (isAnArtist) {
          result.push(whole);
          break;
        }
      }
      if (last === first) result.push(names[first] ?? "");
      first = last + 1;
    }
    return result;
  };

  return (credit) => {
    const names = new Map<string, string>();
    for (const segment of segments(credit)) {
      for (const name of namesOf(segment)) {
        const key = identityKey(name);
        if (name !== "" && !names.has(key)) names.set(key, name);
      }
    }
    return names.size === 0 ? [UNKNOWN_ARTIST] : [...names.values()];
  };
};

/** The artists [credit] names, the primary artist first (see `creditSplitter`). */
export const splitCredit = (credit: string, knownCredits: Iterable<string> = []): string[] =>
  creditSplitter(knownCredits)(credit);

/** An artist leaving the Library: nothing is credited to them any more. */
export interface PrunedArtist {
  readonly id: number;
  readonly name: string;
}

/**
 * Who deleted songs' plays count for once [pruned] artists leave the Library.
 * A pruned artist that was a whole credit from before credits were split
 * ("Ariana Grande, Doja Cat", as [split] splits it now) hands its place in each
 * deleted song ([deletedSongs]: the artist ids each credited, in credit order)
 * to every artist it names that stays in the Library ([staying], ids by
 * identity key), in credit order, a name credited twice once. The rest keep
 * their artists. Only the deleted songs whose artists change are returned.
 */
export const respreadDeletedSongs = ({
  pruned,
  staying,
  deletedSongs,
  split,
}: {
  readonly pruned: readonly PrunedArtist[];
  readonly staying: ReadonlyMap<string, number>;
  readonly deletedSongs: ReadonlyMap<number, readonly number[]>;
  readonly split: (credit: string) => readonly string[];
}): Map<number, number[]> => {
  const heirs = new Map<number, number[]>();
  for (const artist of pruned) {
    const keys = split(artist.name).map(identityKey);
    if (keys.length === 1 && keys[0] === identityKey(artist.name)) continue;
    const ids = keys.flatMap((key) => staying.get(key) ?? []);
    if (ids.length > 0) heirs.set(artist.id, ids);
  }
  const changed = new Map<number, number[]>();
  for (const [song, artists] of deletedSongs) {
    if (!artists.some((artist) => heirs.has(artist))) continue;
    changed.set(song, [...new Set(artists.flatMap((artist) => heirs.get(artist) ?? [artist]))]);
  }
  return changed;
};
