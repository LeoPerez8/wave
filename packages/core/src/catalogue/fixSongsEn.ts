import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";

const count = (n: number): string => formatNumber("en", n);
const songs = (n: number): string =>
  `${count(n)} ${plural("en", n, { one: "song", other: "songs" })}`;

/** "a", "a and b", "a, b and c". */
const listed = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const EVERYTHING = "lyrics, a genre, a track number, a year and an explicit flag";

/**
 * Fix Song and Fix Songs on the whole Library: progress, the summary
 * (`describeTagLookups`) and the toast (`tagLookupsToast`).
 */
export const fixSongsEn = {
  progress: "Fixing songs…",
  progressCount: (done: number, total: number) => `${count(done)} of ${count(total)}`,
  /** What Fix Song fills in, by tag. */
  tags: {
    lyrics: "lyrics",
    genre: "genre",
    trackNumber: "track number",
    year: "year",
    explicit: "explicit flag",
  },
  lookupFailed: (title: string) => `Couldn't look up “${title}”`,
  lookupFailedMessage: "LRCLIB or Deezer couldn't be reached. The file wasn't changed.",
  updateFailed: (title: string) => `Couldn't update “${title}”`,
  writeFailedMessage: "Wave couldn't write to the file. It wasn't changed.",
  formatFailedMessage:
    "No lyrics were found, and Wave can't write tags to this file's format. It wasn't changed.",
  songFixed: "Song fixed",
  savedAsLrc: (notWritten: readonly string[]) =>
    `Wave can't write tags to this file's format, so the lyrics were saved beside it as an .lrc file${
      notWritten.length === 0
        ? ""
        : ` and the ${listed(notWritten)} ${notWritten.length === 1 ? "wasn't" : "weren't"} written`
    }.`,
  filledIn: (filled: readonly string[], title: string) =>
    `Filled in the ${listed(filled)} of “${title}”.`,
  nothingToFix: "Nothing to fix",
  allComplete: (n: number) =>
    n === 1
      ? `The only song already has ${EVERYTHING}.`
      : `All ${count(n)} songs already have ${EVERYTHING}.`,
  nothingFound: "Nothing found",
  nothingFoundFor: (title: string) =>
    `Nothing “${title}” is missing was found. The file wasn't changed.`,
  tally: (fixed: number, notFound: number, failed: number) =>
    `${count(fixed)} fixed · ${count(notFound)} not found · ${count(failed)} failed`,
  skipped: (n: number) =>
    `${songs(n)} already had ${EVERYTHING}, so ${n === 1 ? "it was" : "they were"} skipped.`,
  sidecars: (named: readonly string[], more: number) =>
    `Lyrics saved as .lrc files, genre not written (Wave can't write tags to their format): ${named.join(", ")}${more > 0 ? ` and ${count(more)} more` : ""}.`,
  notLookedUp: (n: number, unreachable: boolean) =>
    unreachable
      ? `LRCLIB and Deezer couldn't be reached, so ${songs(n)} ${n === 1 ? "wasn't" : "weren't"} looked up.`
      : `${songs(n)} ${n === 1 ? "wasn't" : "weren't"} looked up.`,
  songsFixed: "Songs fixed",
  stopped: "Fix Songs stopped",
  toast: {
    fixed: (title: string) => `Fixed “${title}”`,
    fixedAsLrc: (title: string) => `Fixed “${title}” · lyrics saved as .lrc`,
    nothingFoundFor: (title: string) => `Nothing found for “${title}”`,
    nothingFixed: "Nothing fixed",
    fixedSongs: (n: number) => `Fixed ${songs(n)}`,
    notFound: (n: number) => `${count(n)} not found`,
    failed: (n: number) => `${count(n)} failed`,
    complete: (n: number) => `${count(n)} already complete`,
    notLookedUp: (n: number, offline: boolean) =>
      `${count(n)} not looked up${offline ? " (offline)" : ""}`,
  },
};
