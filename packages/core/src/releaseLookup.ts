/**
 * Finding the first release dates a playlist's songs lack (docs/spec.md, "Playlist song
 * sorting"): Deezer's track search gives each song's matching recordings and their ISRCs,
 * MusicBrainz's recording search gives each ISRC's first release, and the earliest wins. With
 * none, the song falls back to its Year, then the Deezer album's date.
 */

import { isSameSong } from "./lyricsAndGenre.ts";
import { readReleaseDate, type ReleaseDate } from "./releaseDate.ts";
import { isRecord, readStoredRecord } from "./storedJson.ts";

/** A song as the lookup searches for it. */
export interface ReleaseSong {
  readonly title: string;
  readonly artist: string;
}

/** A Deezer recording that matches the song: its ISRC, and its album for the fallback date. */
export interface ReleaseCandidate {
  readonly isrc: string;
  readonly albumId: number | null;
}

/** How many of Deezer's results are read for one song. */
const SEARCH_RESULTS = 10;

/**
 * How many matching recordings' ISRCs one song asks MusicBrainz about. Deezer lists the
 * likeliest first: in the recorded sample, the earliest date was never past the sixth.
 */
export const RELEASE_CODES_PER_SONG = 6;

/**
 * How many ISRCs one MusicBrainz search asks about: a query of about 1,400 characters, and
 * about one recording per ISRC, which leaves room under the 100 results a page holds.
 */
export const RELEASE_BATCH_CODES = 50;

const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i;

const recordOf = (value: unknown): Readonly<Record<string, unknown>> =>
  isRecord(value) ? value : {};

/**
 * The recordings in Deezer's search [response] whose title and artist match [song] (Core's
 * `isSameSong`), among its first ten results: up to `RELEASE_CODES_PER_SONG`, one per ISRC.
 */
export const releaseCandidates = (song: ReleaseSong, response: unknown): ReleaseCandidate[] => {
  const data = recordOf(response).data;
  if (!Array.isArray(data)) return [];
  const candidates: ReleaseCandidate[] = [];
  for (const result of data.slice(0, SEARCH_RESULTS)) {
    const row = recordOf(result);
    const artist = recordOf(row.artist);
    const album = recordOf(row.album);
    if (
      typeof row.title !== "string" ||
      typeof artist.name !== "string" ||
      typeof row.isrc !== "string" ||
      !ISRC.test(row.isrc) ||
      !isSameSong({ ...song, album: null, durationMs: 0 }, row.title, artist.name)
    )
      continue;
    const isrc = row.isrc.toUpperCase();
    if (candidates.some((candidate) => candidate.isrc === isrc)) continue;
    candidates.push({ isrc, albumId: typeof album.id === "number" ? album.id : null });
    if (candidates.length === RELEASE_CODES_PER_SONG) break;
  }
  return candidates;
};

/**
 * Whether a Deezer answer [body] is a refusal to try again soon: its error object's code 4
 * (quota) or 700 (service busy). Deezer answers every error with HTTP 200 and
 * `{"error": {"type", "message", "code"}}`; any other code, such as 800 ("no data", an album
 * it doesn't know), is an answer that holds nothing.
 */
export const deezerRefused = (body: unknown): boolean => {
  const error = recordOf(body).error;
  return isRecord(error) && (error.code === 4 || error.code === 700);
};

/** [codes] once each, in queries of at most `RELEASE_BATCH_CODES`. */
export const releaseBatches = (codes: readonly string[]): string[][] => {
  const unique = [...new Set(codes)];
  const batches: string[][] = [];
  for (let start = 0; start < unique.length; start += RELEASE_BATCH_CODES)
    batches.push(unique.slice(start, start + RELEASE_BATCH_CODES));
  return batches;
};

/**
 * The halves to ask for instead when MusicBrainz's [response] to [codes] filled a whole page
 * or refused the query, so no ISRC's recordings are lost; null when it answered them all.
 */
export const releaseBatchSplit = (
  codes: readonly string[],
  response: unknown,
): string[][] | null => {
  const body = recordOf(response);
  if (codes.length < 2 || (Number(body.count) < 100 && body.error === undefined)) return null;
  const middle = Math.floor(codes.length / 2);
  return [codes.slice(0, middle), codes.slice(middle)];
};

/**
 * How long to wait before the next request to [service], last started at [last]: MusicBrainz
 * takes one a second, and Deezer's 350 ms stay well under its 50 every 5 seconds.
 */
export const releaseRequestDelay = (
  service: "deezer" | "musicbrainz",
  last: number,
  now: number,
): number => Math.max(0, last + (service === "musicbrainz" ? 1000 : 350) - now);

/** What the lookup found for a song, and when to ask again. */
export interface ReleaseAnswer {
  readonly date: ReleaseDate | null;
  /**
   * Where [date] came from: a first release MusicBrainz knows, the fallbacks (the song's
   * Year, the Deezer album's date), or nothing: neither service knew it, or they failed.
   */
  readonly source: "first-release" | "year" | "album" | "unknown" | "failed";
  /** When the song is due again; null for a first release, which is never asked again. */
  readonly retryAt: number | null;
}

const RETRY_FAILED_MS = 60_000;
const RETRY_UNKNOWN_MS = 30 * 86_400_000;

/**
 * A song's answer: the earliest first release MusicBrainz's [responses] give any of its ISRCs
 * ([codes]), else its [year], else the Deezer album's [albumDate]. Without a first release it's
 * asked again in 30 days, or in a minute when the services [failed].
 */
export const releaseAnswer = (
  codes: readonly string[],
  responses: readonly unknown[],
  year: number | null,
  albumDate: string | null,
  now: number,
  failed = false,
): ReleaseAnswer => {
  const dates: ReleaseDate[] = [];
  for (const response of responses) {
    const recordings = recordOf(response).recordings;
    if (!Array.isArray(recordings)) continue;
    for (const value of recordings) {
      const recording = recordOf(value);
      const date = readReleaseDate(recording["first-release-date"]);
      if (
        date !== null &&
        Array.isArray(recording.isrcs) &&
        recording.isrcs.some((code) => codes.includes(String(code)))
      )
        dates.push(date);
    }
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  const earliest = dates.sort()[0];
  if (earliest !== undefined) return { date: earliest, source: "first-release", retryAt: null };
  const retryAt = now + (failed ? RETRY_FAILED_MS : RETRY_UNKNOWN_MS);
  const yearDate = year === null ? null : readReleaseDate(String(year));
  if (yearDate !== null) return { date: yearDate, source: "year", retryAt };
  const album = readReleaseDate(albumDate);
  if (album !== null) return { date: album, source: "album", retryAt };
  return { date: null, source: failed ? "failed" : "unknown", retryAt };
};

const SOURCES: readonly ReleaseAnswer["source"][] = [
  "first-release",
  "year",
  "album",
  "unknown",
  "failed",
];

/**
 * The answers [stored] holds, by song key: an entry that isn't an answer (no known source, a
 * date that isn't one, a retry that isn't a time) is left out, so its song is asked again.
 */
export const readReleaseAnswers = (stored: string | null): Record<string, ReleaseAnswer> => {
  const answers: Record<string, ReleaseAnswer> = {};
  for (const [key, value] of Object.entries(readStoredRecord(stored))) {
    const entry = recordOf(value);
    const source = SOURCES.find((known) => known === entry.source);
    const date = entry.date === null ? null : readReleaseDate(entry.date);
    const { retryAt } = entry;
    if (source === undefined || (date === null && entry.date !== null)) continue;
    if (retryAt !== null && !Number.isSafeInteger(retryAt)) continue;
    answers[key] = { date, source, retryAt: retryAt as number | null };
  }
  return answers;
};

/** The release date of Deezer's album [body], null when it has none (or Deezer doesn't know it). */
export const deezerAlbumDate = (body: unknown): ReleaseDate | null =>
  readReleaseDate(recordOf(body).release_date);

/**
 * Whether [song] is looked up at [now]: it has a title and an artist, no date that no lookup
 * replaces ([held]: its original-date tag, or one the owner typed), and no answer yet, or one
 * whose retry is due.
 */
export const releaseDue = (
  song: ReleaseSong,
  held: string | null | undefined,
  answer: ReleaseAnswer | null | undefined,
  now: number,
): boolean =>
  song.title.trim() !== "" &&
  song.artist.trim() !== "" &&
  !held &&
  (!answer || (answer.retryAt !== null && answer.retryAt <= now));

/**
 * The first-release date to write into a song's original-date tag, or null for none: only a
 * date the lookup found ([answer]'s `first-release`), only for a song with a file, and never
 * over a date it already [held] (its tag's or one the owner typed). Fallback dates (Year, the
 * Deezer album's) never reach a file.
 */
export const releaseTagDate = (song: {
  readonly answer: ReleaseAnswer | null | undefined;
  readonly held: string | null | undefined;
  readonly hasFile: boolean;
}): string | null =>
  song.hasFile && !song.held && song.answer?.source === "first-release" ? song.answer.date : null;

/** One of a playlist's songs, as a lookup run takes it. */
export interface ReleaseLookupSong extends ReleaseSong {
  /** The key its answer is kept under; songs with the same key are asked about once. */
  readonly key: string;
  readonly year: number | null;
  /** A date no lookup replaces: its original-date tag, or one the owner typed. */
  readonly held: string | null;
  /** Its answer so far. */
  readonly answer: ReleaseAnswer | null;
}

/** The requests a lookup run makes (the app's `releaseLookupClient`). */
export interface ReleaseServices {
  /** Deezer's track search for [title] by [artist]; throws when Deezer refused or failed. */
  readonly search: (title: string, artist: string) => Promise<unknown>;
  /** MusicBrainz's answers about [codes], every page; throws when it refused or failed. */
  readonly recordings: (codes: readonly string[]) => Promise<readonly unknown[]>;
  /** Deezer's album [id]; throws when Deezer refused or failed. */
  readonly album: (id: number) => Promise<unknown>;
}

/** What a playlist's lookup shows while it runs: songs answered of all, and whether it failed. */
export interface ReleaseProgress {
  readonly done: number;
  readonly total: number;
  readonly offline: boolean;
}

/**
 * The line Settings shows beside Search online for the background lookup: songs done of all
 * while it runs, null when nothing runs (no lookup, or a failure waiting for its retry).
 */
export const releaseBackgroundLine = (
  progress: ReleaseProgress | null,
): { readonly done: number; readonly total: number } | null =>
  progress === null || progress.offline ? null : { done: progress.done, total: progress.total };

/**
 * How a lookup run ended: every due song answered, a request failed (the rest waits for its
 * retry), or [going] turned false.
 */
export type ReleaseLookupEnd = "done" | "failed" | "stopped";

/**
 * Looks up the due songs of a playlist's [songs] (`releaseDue`), each key once. Each song is
 * searched on Deezer, and as soon as the songs searched hold `RELEASE_BATCH_CODES` ISRCs
 * (never splitting a song's) MusicBrainz is asked about them, while the next songs are searched.
 * A song MusicBrainz has no date for asks Deezer for its albums' dates. Each answer goes to
 * [answered] as it's known, and [progress] follows them (null once nothing is left to show).
 *
 * A request that fails stops the run: that song, or the songs of a MusicBrainz query, get a
 * `failed` answer (a minute's retry, keeping a fallback date they had), songs already searched
 * are still asked about, and the rest wait for the next run. Nothing new starts once [going] is
 * false, and a request it stopped answers no song.
 */
export const lookUpReleaseDates = async ({
  songs,
  services,
  now,
  going,
  answered,
  progress,
}: {
  readonly songs: readonly ReleaseLookupSong[];
  readonly services: ReleaseServices;
  readonly now: () => number;
  readonly going: () => boolean;
  readonly answered: (song: ReleaseLookupSong, answer: ReleaseAnswer) => Promise<void>;
  readonly progress: (progress: ReleaseProgress | null) => void;
}): Promise<ReleaseLookupEnd> => {
  const byKey = new Map<string, ReleaseLookupSong>();
  for (const song of songs) if (!byKey.has(song.key)) byKey.set(song.key, song);
  const unique = [...byKey.values()];
  const at = now();
  const due = unique.filter((song) => releaseDue(song, song.held, song.answer, at));
  if (due.length === 0) {
    progress(null);
    return "done";
  }
  let done = unique.length - due.length;
  let failed = false;
  const show = () => progress({ done, total: unique.length, offline: failed });
  show();

  const answer = async (song: ReleaseLookupSong, found: ReleaseAnswer) => {
    await answered(song, found);
    done++;
    show();
  };
  const fail = async (song: ReleaseLookupSong) => {
    failed = true;
    if (song.answer?.source === "first-release") return;
    const fallback = song.answer?.source === "album" ? song.answer.date : null;
    await answer(song, releaseAnswer([], [], song.year, fallback, now(), true));
  };
  const earliestAlbumDate = async (candidates: readonly ReleaseCandidate[]) => {
    const dates: ReleaseDate[] = [];
    for (const id of new Set(candidates.map((candidate) => candidate.albumId))) {
      if (id === null) continue;
      const date = deezerAlbumDate(await services.album(id));
      if (date !== null) dates.push(date);
    }
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    return dates.sort()[0] ?? null;
  };

  type Searched = { readonly song: ReleaseLookupSong; readonly candidates: ReleaseCandidate[] };
  const settle = async (batch: readonly Searched[]): Promise<void> => {
    const codes = batch.flatMap(({ candidates }) => candidates.map((candidate) => candidate.isrc));
    let responses: readonly unknown[] = [];
    try {
      if (codes.length > 0) responses = await services.recordings(codes);
    } catch {
      if (going()) for (const { song } of batch) await fail(song);
      return;
    }
    for (const { song, candidates } of batch) {
      const isrcs = candidates.map((candidate) => candidate.isrc);
      const found = releaseAnswer(isrcs, responses, song.year, null, now());
      if (found.date !== null) {
        await answer(song, found);
        continue;
      }
      let albumDate: ReleaseDate | null;
      try {
        albumDate = await earliestAlbumDate(candidates);
      } catch {
        if (going()) await fail(song);
        continue;
      }
      await answer(song, releaseAnswer([], [], song.year, albumDate, now()));
    }
  };

  const settling: Promise<void>[] = [];
  let open: Searched[] = [];
  let openCodes = 0;
  for (const song of due) {
    if (failed || !going()) break;
    let candidates: ReleaseCandidate[];
    try {
      candidates = releaseCandidates(song, await services.search(song.title, song.artist));
    } catch {
      if (going()) await fail(song);
      break;
    }
    if (open.length > 0 && openCodes + candidates.length > RELEASE_BATCH_CODES) {
      settling.push(settle(open));
      open = [];
      openCodes = 0;
    }
    open.push({ song, candidates });
    openCodes += candidates.length;
  }
  if (open.length > 0 && going()) settling.push(settle(open));
  await Promise.all(settling);
  const end: ReleaseLookupEnd = failed ? "failed" : going() ? "done" : "stopped";
  if (end !== "failed") progress(null);
  return end;
};

/**
 * When the next of [songs] (a playlist's, as `lookUpReleaseDates` takes them) is due for a
 * lookup: [now] for one never asked, its answer's retry for the rest, null when none ever is.
 */
export const releaseNextDue = (songs: readonly ReleaseLookupSong[], now: number): number | null => {
  let next: number | null = null;
  for (const song of songs) {
    if (!releaseDue(song, song.held, null, now)) continue;
    const at = song.answer === null ? now : song.answer.retryAt;
    if (at !== null && (next === null || at < next)) next = Math.max(at, now);
  }
  return next;
};
