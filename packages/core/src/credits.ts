/**
 * Artist credits: the artists a credit as tagged ("Ariana Grande, Doja Cat")
 * names, so a collaboration belongs to each of them.
 *
 * - `,` `·` `;` `/`, "feat." / "ft." / "featuring" / "with" (bracketed or not)
 *   and " x " always separate artists.
 * - "&" and "and" separate them too, unless that part of the credit is an
 *   artist in the Library: a known whole credit ("Simon & Garfunkel") none of
 *   whose parts is credited on its own anywhere. So a collaboration's own
 *   credit ("Ariana Grande & Social House") doesn't keep it whole once
 *   "Ariana Grande" is credited alone.
 */
import { UNKNOWN_ARTIST, identityKey } from "./library.ts";

/** Words that introduce another artist: "feat." / "ft." (dot optional), "featuring", "with". */
const JOINING_WORD = String.raw`(?:feat|ft)\b\.?|featuring\b|with\b`;

/** A bracketed featured credit, "(feat. X)" or "[with X]": the brackets go, the credit stays. */
const BRACKETED_CREDIT = new RegExp(String.raw`[([]\s*\b(${JOINING_WORD})([^)\]]*)[)\]]`, "giu");

/** Marks that always separate artists ("Lil Nas X x Billy Ray Cyrus" splits on the last x). */
const SEPARATOR = new RegExp(
  String.raw`\s*(?:[,;·/]|\b(?:${JOINING_WORD}))\s*|\s+x\s+(?!x\s)`,
  "giu",
);

/** "&" and "and", which separate artists unless the Library knows the whole name. */
const AMPERSAND = /\s*&\s*|\s+and\s+/giu;

const tidy = (name: string): string => name.replace(/\s+/g, " ").trim();

/** The parts of [credit] between marks that always separate artists. */
const segments = (credit: string): string[] =>
  credit.replace(BRACKETED_CREDIT, " $1$2").split(SEPARATOR).map(tidy);

const ampersandParts = (segment: string): string[] => segment.split(AMPERSAND).map(tidy);

const hasAmpersand = (segment: string): boolean => ampersandParts(segment).length > 1;

/**
 * Splits credits with the Library's whole credits ([knownCredits]) in mind;
 * build one per Library and reuse it.
 */
export const creditSplitter = (knownCredits: Iterable<string>): ((credit: string) => string[]) => {
  const known = new Set<string>();
  // Names credited on their own somewhere: a part between separators with no "&".
  const standing = new Set<string>();
  for (const credit of knownCredits) {
    known.add(identityKey(credit));
    for (const segment of segments(credit)) {
      if (segment !== "" && !hasAmpersand(segment)) standing.add(identityKey(segment));
    }
  }
  const isAnArtist = (segment: string): boolean =>
    known.has(identityKey(segment)) &&
    !ampersandParts(segment).some((part) => standing.has(identityKey(part)));

  return (credit) => {
    const names = new Map<string, string>();
    for (const segment of segments(credit)) {
      for (const name of isAnArtist(segment) ? [segment] : ampersandParts(segment)) {
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
