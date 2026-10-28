/**
 * Genius's annotations on a song's lyrics (docs/spec.md, "Genius
 * annotations"): what Wave asks Genius's `/referents` for, what its replies
 * say, and where each annotated fragment sits on Wave's own lyric lines. The
 * app sends the requests and draws the highlights.
 */

import { geniusResponse } from "./geniusReply.ts";
import { isRecord } from "./storedJson.ts";

/**
 * One annotation on a fragment: its plain text, who wrote it, and whether
 * Genius's editors accepted it or it's still `pending` (genius.com's
 * "Unreviewed").
 */
export interface GeniusAnnotation {
  readonly text: string;
  readonly authors: readonly string[];
  readonly state: GeniusAnnotationState;
}

export type GeniusAnnotationState = "accepted" | "pending";

/** An annotation's `state` as Genius gives it: only "pending" is unreviewed. */
const annotationState = (state: unknown): GeniusAnnotationState =>
  state === "pending" ? "pending" : "accepted";

/** A fragment of Genius's lyrics and the annotations explaining it. */
export interface GeniusReferent {
  readonly id: number;
  readonly fragment: string;
  readonly annotations: readonly GeniusAnnotation[];
}

/** How many referents Wave asks for at once (Genius's most). */
export const GENIUS_REFERENTS_PER_PAGE = 50;

/** At most this many pages are asked for one song. */
export const GENIUS_REFERENTS_MAX_PAGES = 20;

/** Page [page] (from 1) of the referents of Genius's song [id], as plain text. */
export const geniusReferentsUrl = (id: number, page: number): string =>
  `https://api.genius.com/referents?song_id=${id}&text_format=plain&per_page=${GENIUS_REFERENTS_PER_PAGE}&page=${page}`;

const readAnnotation = (value: unknown): GeniusAnnotation[] => {
  if (!isRecord(value) || !isRecord(value.body) || typeof value.body.plain !== "string") return [];
  const text = value.body.plain.trim();
  if (text === "" || text === "?") return [];
  const authors = Array.isArray(value.authors)
    ? value.authors.flatMap((author: unknown) => {
        if (!isRecord(author) || !isRecord(author.user)) return [];
        const { name, login } = author.user;
        const shown =
          typeof name === "string" && name.trim() !== ""
            ? name.trim()
            : typeof login === "string"
              ? login.trim()
              : "";
        return shown === "" ? [] : [shown];
      })
    : [];
  return [{ text, authors, state: annotationState(value.state) }];
};

/**
 * A referent of a lyric fragment with at least one annotation with text;
 * null for anything else (the song's description, another song's, unreadable).
 */
const readReferent = (value: unknown, song: number | null): GeniusReferent | null => {
  if (!isRecord(value) || value.is_description === true) return null;
  if (song !== null && value.song_id !== song) return null;
  const { id, fragment } = value;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || typeof fragment !== "string")
    return null;
  if (fragment.trim() === "" || !Array.isArray(value.annotations)) return null;
  const annotations = value.annotations.flatMap(readAnnotation);
  return annotations.length === 0 ? null : { id, fragment, annotations };
};

/**
 * One page of Genius's referents for the song [id]: the lyric fragments it
 * annotates, with their annotations. Genius gives no page count, so a page
 * with fewer than `GENIUS_REFERENTS_PER_PAGE` referents is the [last]. Null
 * for a failed or unreadable reply.
 */
export const geniusReferentsPage = (
  reply: unknown,
  id: number,
): { readonly referents: readonly GeniusReferent[]; readonly last: boolean } | null => {
  const response = geniusResponse(reply);
  if (response === null || !Array.isArray(response.referents)) return null;
  const raw: unknown[] = response.referents;
  return {
    referents: raw.flatMap((each) => readReferent(each, id) ?? []),
    last: raw.length < GENIUS_REFERENTS_PER_PAGE,
  };
};

/** [value] as saved referents (`storedGenius`), or null when it isn't one. */
export const savedGeniusReferents = (value: unknown): readonly GeniusReferent[] | null => {
  if (!Array.isArray(value)) return null;
  const referents: GeniusReferent[] = [];
  for (const each of value) {
    if (
      !isRecord(each) ||
      typeof each.id !== "number" ||
      typeof each.fragment !== "string" ||
      !Array.isArray(each.annotations)
    )
      return null;
    const annotations: GeniusAnnotation[] = [];
    for (const annotation of each.annotations) {
      if (
        !isRecord(annotation) ||
        typeof annotation.text !== "string" ||
        !Array.isArray(annotation.authors) ||
        !annotation.authors.every((author: unknown) => typeof author === "string")
      )
        return null;
      // Answers saved before Wave kept the state count as accepted.
      annotations.push({
        text: annotation.text,
        authors: annotation.authors as string[],
        state: annotationState(annotation.state),
      });
    }
    referents.push({ id: each.id, fragment: each.fragment, annotations });
  }
  return referents;
};

/** A fragment that is a single section heading, `[Verse 1]` or `[Chorus: Freddie Mercury]`. */
const SECTION = /^\s*\[([^[\]]+)\]\s*$/;

/**
 * The section [fragment] names when it is only a section heading (`[Verse
 * 1]` gives "Verse 1"): its annotation explains the whole section, which
 * isn't one place on the lines, so it goes to More insights under that
 * name. Null for a fragment of lyrics.
 */
export const geniusSection = (fragment: string): string | null =>
  SECTION.exec(fragment)?.[1]!.trim() || null;

/**
 * Part of a lyric line a fragment covers: [start, end) in the line's text,
 * and the referents a tap there opens: the fragment placed there first, then
 * any shorter one found only inside it.
 */
export interface GeniusHighlight {
  readonly start: number;
  readonly end: number;
  readonly referents: readonly GeniusReferent[];
}

/**
 * Where Genius's referents sit on Wave's lyric lines: each line's highlights
 * in order, and the referents whose fragment fits nowhere (shown under the
 * lyrics as "More insights").
 */
export interface GeniusPlacement {
  readonly lines: readonly (readonly GeniusHighlight[])[];
  readonly unplaced: readonly GeniusReferent[];
}

/** Brackets whose content is an ad-lib or a section heading, not lyrics to compare. */
const PAIRS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
const APOSTROPHE = /^['’ʼ‘`´]$/u;
const LETTER = /[\p{L}\p{N}]/gu;
const MARKS = /\p{M}/gu;

/** Which of [text]'s UTF-16 units sit inside a closed bracket pair, the brackets included. */
const bracketed = (text: string): boolean[] => {
  const inside = Array.from({ length: text.length }, () => false);
  const open: number[] = [];
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!;
    if (PAIRS[char] !== undefined) open.push(at);
    else if (open.length > 0 && PAIRS[text[open.at(-1)!]!] === char) {
      const from = open.pop()!;
      for (let each = from; each <= at; each += 1) inside[each] = true;
    }
  }
  return inside;
};

/**
 * Lyrics as compared: only letters and digits, lower case, without accents
 * or bracketed ad-libs. Each unit remembers which line and which part of it
 * it came from, and whether a word starts or ends there; apostrophes join
 * a word ("don't", "rock 'n' roll"), anything else separates words.
 */
interface Compared {
  text: string;
  readonly line: number[];
  readonly from: number[];
  readonly to: number[];
  readonly starts: boolean[];
  readonly ends: boolean[];
}

const compare = (into: Compared, text: string, line: number): void => {
  const inside = bracketed(text);
  let inWord = false;
  const close = (): void => {
    if (inWord) into.ends[into.ends.length - 1] = true;
    inWord = false;
  };
  for (let at = 0; at < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(at)!);
    const next = at + char.length;
    const letters = inside[at]
      ? ""
      : (char.toLowerCase().normalize("NFD").replace(MARKS, "").match(LETTER) ?? []).join("");
    if (letters !== "") {
      for (let unit = 0; unit < letters.length; unit += 1) {
        into.text += letters[unit];
        into.line.push(line);
        into.from.push(at);
        into.to.push(next);
        into.starts.push(!inWord && unit === 0);
        into.ends.push(false);
      }
      inWord = true;
    } else if (!(inWord && !inside[at] && APOSTROPHE.test(char))) close();
    at = next;
  }
  close();
};

const compared = (): Compared => ({ text: "", line: [], from: [], to: [], starts: [], ends: [] });

/**
 * Places Genius's [referents] on Wave's lyric [lines] (LRCLIB's, a file's or
 * YT Music's, which never match Genius's text exactly): a fragment fits
 * where its words follow each other in the lyrics, whole words only, case,
 * accents, punctuation and bracketed ad-libs aside. It may be part of a line
 * or run over several; it gets every place it fits (a repeated chorus).
 * Longer fragments are placed first and places never overlap: a shorter
 * fragment found only inside places already taken joins each of them, so a
 * tap there opens both. A section heading's referent (`geniusSection`), and
 * one that fits nowhere, is listed as unplaced, in Genius's order.
 */
export const placeGeniusReferents = (
  lines: readonly string[],
  referents: readonly GeniusReferent[],
): GeniusPlacement => {
  const lyrics = compared();
  lines.forEach((line, at) => compare(lyrics, line, at));
  /** Each place: where it starts and ends in the compared lyrics, and its referents. */
  const places: { readonly at: number; readonly end: number; referents: GeniusReferent[] }[] = [];
  /** Which place (from 1) holds each compared unit; 0 for none. */
  const taken = new Int32Array(lyrics.text.length);
  const placed = new Set<GeniusReferent>();
  const wanted = referents
    // A section's annotation explains the whole section: never placed, even on a heading line.
    .filter((referent) => geniusSection(referent.fragment) === null)
    .map((referent) => {
      const fragment = compared();
      compare(fragment, referent.fragment, 0);
      return { referent, text: fragment.text };
    })
    .filter((each) => each.text !== "")
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    .sort((a, b) => b.text.length - a.text.length);
  for (const { referent, text } of wanted) {
    const inside = new Set<number>();
    for (let at = lyrics.text.indexOf(text); at !== -1; at = lyrics.text.indexOf(text, at + 1)) {
      const end = at + text.length;
      if (!lyrics.starts[at] || !lyrics.ends[end - 1]) continue;
      const holders = new Set(taken.subarray(at, end));
      if (holders.size === 1 && holders.has(0)) {
        places.push({ at, end, referents: [referent] });
        taken.fill(places.length, at, end);
        placed.add(referent);
      } else if (holders.size === 1) inside.add(taken[at]!);
    }
    if (placed.has(referent)) continue;
    for (const place of inside) places[place - 1]!.referents.push(referent);
    if (inside.size > 0) placed.add(referent);
  }
  const highlights: GeniusHighlight[][] = lines.map(() => []);
  for (const { at, end, referents: shown } of places) {
    for (let unit = at; unit < end; unit += 1) {
      const spans = highlights[lyrics.line[unit]!]!;
      const last = spans.at(-1);
      if (last?.referents === shown && unit > at && lyrics.line[unit - 1] === lyrics.line[unit])
        spans[spans.length - 1] = { ...last, end: lyrics.to[unit]! };
      else spans.push({ start: lyrics.from[unit]!, end: lyrics.to[unit]!, referents: shown });
    }
  }
  return {
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    lines: highlights.map((spans) => spans.sort((a, b) => a.start - b.start)),
    unplaced: referents.filter((referent) => !placed.has(referent)),
  };
};

/** A run of a lyric line drawn alike: under one highlight (or none) and one word. */
export interface GeniusLineSegment {
  readonly start: number;
  readonly end: number;
  /** The word it belongs to (Karaoke's sung word index), -1 before the first. */
  readonly word: number;
  /** The referents a tap on it opens (its highlight's); none off the highlights. */
  readonly referents: readonly GeniusReferent[];
}

const NOT_HIGHLIGHTED: readonly GeniusReferent[] = [];

/**
 * [text] cut wherever a highlight or a word starts or ends, so a line can
 * light Karaoke's words over Genius's highlights. [wordStarts] are where its
 * words start, in order (none for a line drawn whole).
 */
export const geniusLineSegments = (
  text: string,
  highlights: readonly GeniusHighlight[],
  wordStarts: readonly number[] = [],
): readonly GeniusLineSegment[] => {
  const cuts = [
    ...new Set([
      0,
      text.length,
      ...wordStarts,
      ...highlights.flatMap((highlight) => [highlight.start, highlight.end]),
    ]),
  ]
    .filter((cut) => cut >= 0 && cut <= text.length)
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    .sort((a, b) => a - b);
  return cuts.slice(0, -1).map((start, at) => {
    let word = -1;
    while (word + 1 < wordStarts.length && wordStarts[word + 1]! <= start) word += 1;
    const highlight = highlights.find((each) => each.start <= start && start < each.end);
    return { start, end: cuts[at + 1]!, word, referents: highlight?.referents ?? NOT_HIGHLIGHTED };
  });
};
