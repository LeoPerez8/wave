import { normalizeSearchText } from "./search.ts";
import type { YtSong } from "./ytMusic.ts";

/** Peer claims. Native full-file validation decides whether audio is usable. */
export interface SoulseekCandidate {
  readonly username: string;
  readonly filename: string;
  readonly bytes: number;
  readonly bitrateKbps: number | null;
  readonly durationMs: number | null;
  readonly freeSlot: boolean;
  readonly uploadSpeed: number;
  readonly queueLength: number;
}

const fold = normalizeSearchText;
const credit = (text: string): string =>
  text
    .replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]/gi, "")
    .replace(/\s+\b(?:feat\.?|ft\.?|featuring)\s+.*$/i, "")
    .trim();
const editionMarker =
  /\b(?:live|remix|mix|radio edit|edit|extended|acoustic|instrumental|demo|remaster(?:ed)?|re[ -]?record(?:ed|ing)|clean|explicit|mono|stereo|version)\b/i;

const editions = (text: string, album = false): string[] => {
  const notes = [...text.matchAll(/[([]([^\])]+)[\])]/g)].map((match) => match[1] ?? "");
  if (
    album &&
    !notes.some((note) => editionMarker.test(note)) &&
    /^(?:live\b|.*\b(?:remix|remaster(?:ed)?|acoustic|instrumental|radio edit|clean|explicit)\b)/i.test(
      text,
    )
  )
    notes.push(text);
  const suffix = text.match(/\s+-\s+(.+)$/)?.[1];
  if (suffix !== undefined) notes.push(suffix);
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  return [...new Set(notes.filter((note) => editionMarker.test(note)).map(fold))].sort();
};

/** The title without guests and edition notes, as written. */
const bareTitle = (text: string): string =>
  credit(text)
    .replace(/[([]([^\])]+)[\])]/g, (whole: string, note: string) =>
      editionMarker.test(note) ? "" : whole,
    )
    .replace(/\s+-\s+(.+)$/, (whole: string, note: string) =>
      editionMarker.test(note) ? "" : whole,
    );
const title = (text: string): string => fold(bareTitle(text));

/**
 * What to search Soulseek for. Peers only return files whose path has every
 * query word, so this keeps the words Core matches on: the main artist and the
 * title, without guests, edition notes or punctuation. Letters keep their
 * accents, since peers don't fold them. A word with an apostrophe is left out,
 * because peers split "Don't" in different ways.
 */
export const soulseekQuery = (song: YtSong): string =>
  `${credit(song.artists[0] ?? "")} ${bareTitle(song.title)}`
    .split(/\s+/)
    .filter((word) => !/['’ʼ`´]/.test(word))
    .join(" ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .join(" ");

const positiveDuration = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value > 0;
const availableNumber = (value: number): number =>
  Number.isFinite(value) && value >= 0 ? value : 0;
const sameEditions = (a: readonly string[], b: readonly string[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
const featuredNames = (text: string): string[] =>
  [...text.matchAll(/\b(?:feat\.?|ft\.?|featuring)\s+([^)[\]]+)/gi)]
    .flatMap((match) => (match[1] ?? "").split(/,\s*|\s+(?:&|and)\s+/i))
    .map(fold)
    .filter((name) => name !== "");

/** Persist this policy with a native job; received tags must agree before overwriting them. */
export interface SoulseekRecording {
  readonly title: string;
  readonly artist: string;
  readonly artistCredits: readonly string[];
  readonly editions: readonly string[];
  readonly durationMs: number | null;
}

export const soulseekRecording = (song: YtSong): SoulseekRecording => ({
  title: title(song.title),
  artist: fold(credit(song.artists[0] ?? "")),
  artistCredits: [
    ...new Set([
      ...song.artists.map((artist) => fold(credit(artist))),
      ...song.artists.flatMap(featuredNames),
      ...featuredNames(song.title),
    ]),
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  ].sort(),
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  editions: [...new Set([...editions(song.title), ...editions(song.album ?? "", true)])].sort(),
  durationMs: positiveDuration(song.durationMs) ? song.durationMs : null,
});

const artistMatches = (text: string, recording: SoulseekRecording): boolean => {
  if (!featuredNames(text).every((name) => recording.artistCredits.includes(name))) return false;
  if (fold(credit(text)) === recording.artist) return true;
  const names = credit(text)
    .split(/,\s*|\s+(?:&|and|x)\s+/i)
    .map(fold);
  return (
    names[0] === recording.artist &&
    names.slice(1).every((name) => recording.artistCredits.includes(name))
  );
};

export interface SoulseekReceivedTags {
  readonly title: string | null;
  readonly artist: string | null;
  readonly album: string | null;
}

/** Missing tags use trusted result metadata; a contradictory tag always rejects the peer. */
export const soulseekReceivedMatches = (
  song: YtSong,
  tags: SoulseekReceivedTags,
  durationMs: number,
): boolean => {
  const recording = soulseekRecording(song);
  if (
    !positiveDuration(durationMs) ||
    (recording.durationMs !== null && Math.abs(recording.durationMs - durationMs) > 3_000)
  )
    return false;
  if (
    tags.title !== null &&
    (title(tags.title) !== recording.title ||
      !featuredNames(tags.title).every((name) => recording.artistCredits.includes(name)) ||
      !editions(tags.title).every((edition) => recording.editions.includes(edition)))
  )
    return false;
  if (tags.artist !== null && !artistMatches(tags.artist, recording)) return false;
  if (
    tags.album !== null &&
    !editions(tags.album, true).every((edition) => recording.editions.includes(edition))
  )
    return false;
  return true;
};

/** Unknown duration never establishes cross-result recording identity. */
export const soulseekSameRecording = (a: YtSong, b: YtSong): boolean => {
  const left = soulseekRecording(a),
    right = soulseekRecording(b);
  return (
    left.durationMs !== null &&
    right.durationMs !== null &&
    Math.abs(left.durationMs - right.durationMs) <= 3_000 &&
    left.title !== "" &&
    left.artist !== "" &&
    left.title === right.title &&
    left.artist === right.artist &&
    sameEditions(left.editions, right.editions) &&
    sameEditions(left.artistCredits, right.artistCredits)
  );
};

/** Eligible original MP3 320 peers for exactly the requested recording. */
export const soulseekCandidates = (
  song: YtSong,
  candidates: readonly SoulseekCandidate[],
): SoulseekCandidate[] => {
  const recording = soulseekRecording(song);
  const wantedTitle = recording.title;
  const artist = recording.artist;
  const wantedEditions = recording.editions;
  if (wantedTitle === "" || artist === "") return [];
  const seen = new Set<string>();
  const suitable = candidates.filter((candidate) => {
    if (
      !candidate.filename.toLowerCase().endsWith(".mp3") ||
      candidate.bitrateKbps !== 320 ||
      !Number.isFinite(candidate.bytes) ||
      candidate.bytes <= 0
    )
      return false;
    const path = candidate.filename.split(/[\\/]/);
    const file = (path.at(-1) ?? "").replace(/\.mp3$/i, "");
    const album = path.at(-2) ?? "";
    const folderArtist = path.at(-3) ?? "";
    const names = (named: string): boolean => {
      const split = named.indexOf(" - ");
      const fileArtist = split < 0 ? "" : named.slice(0, split);
      const name = split < 0 ? named : named.slice(split + 3);
      return (
        (fileArtist !== ""
          ? artistMatches(fileArtist, recording)
          : artistMatches(folderArtist, recording) || artistMatches(album, recording)) &&
        title(name) === wantedTitle &&
        featuredNames(name).every((guest) => recording.artistCredits.includes(guest)) &&
        sameEditions(
          wantedEditions,
          // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
          [...new Set([...editions(name), ...editions(album, true)])].sort(),
        )
      );
    };
    // A leading number is a track number ("08 - Get Lucky") or part of a name ("50 Cent - …",
    // "7 rings"): the file qualifies if either reading names the recording.
    const untracked = file.replace(/^\s*(?:\d{1,2}[-.]\d{1,3}|\d{1,3})\s*[. -]\s*/, "");
    if (!names(untracked) && (untracked === file || !names(file))) return false;
    if (!positiveDuration(song.durationMs) && !positiveDuration(candidate.durationMs)) return false;
    if (
      positiveDuration(song.durationMs) &&
      positiveDuration(candidate.durationMs) &&
      Math.abs(song.durationMs - candidate.durationMs) > 3_000
    )
      return false;
    const identity = JSON.stringify([candidate.username, candidate.filename]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  const confidence = (candidate: SoulseekCandidate): number =>
    (positiveDuration(candidate.durationMs) ? 2 : 0) +
    (song.album !== null &&
    fold(candidate.filename.split(/[\\/]/).at(-2) ?? "") === fold(song.album)
      ? 1
      : 0);
  // oxlint-disable-next-line unicorn/no-array-sort -- filter made a fresh array; Hermes lacks toSorted
  suitable.sort(
    (a, b) =>
      confidence(b) - confidence(a) ||
      Number(b.freeSlot) - Number(a.freeSlot) ||
      availableNumber(a.queueLength) - availableNumber(b.queueLength) ||
      availableNumber(b.uploadSpeed) - availableNumber(a.uploadSpeed) ||
      a.username.localeCompare(b.username) ||
      a.filename.localeCompare(b.filename),
  );
  return suitable.slice(0, 3);
};
