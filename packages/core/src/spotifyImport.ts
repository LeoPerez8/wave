/**
 * Importing a Spotify playlist (docs/spec.md, "Importing playlists from a
 * link"): which YouTube Music result is a Spotify song, finding every song
 * of a playlist in the Library or on YouTube Music, and what the import makes.
 */

import { splitCredit } from "./credits.ts";
import { UNKNOWN_ARTIST } from "./library.ts";
import { importedPlaylistName } from "./m3u.ts";
import { planPlaylistSongs, type PlaylistSong } from "./playlistEntries.ts";
import type { LinkImportPlan, NotFoundSong } from "./playlistLinks.ts";
import { normalizeSearchText } from "./search.ts";
import type { SpotifyPlaylist, SpotifySong } from "./spotifyPlaylist.ts";
import { joinArtists, libraryFinder, type LibrarySongKey, type YtSong } from "./ytMusic.ts";
import type { YtQuietReason } from "./ytSearch.ts";

/** What a song is looked up on YouTube Music by: its title and artists, all that is sent. */
export const spotifySearchQuery = (song: SpotifySong): string =>
  [song.title, ...song.artists].join(" ");

/** Lengths this close are one recording (as downloads decide). */
const SAME_LENGTH_MS = 3000;

const fold = normalizeSearchText;
const UNKNOWN = fold(UNKNOWN_ARTIST);
const ARTICLE = /^the /u;

/** The artists [credits] name, split as the Library splits credits, compared folded and without "The". */
const artistNames = (credits: readonly string[]): string[] =>
  credits
    .flatMap((credit) => splitCredit(credit))
    .map((name) => fold(name).replace(ARTICLE, ""))
    .filter((name) => name !== "" && name !== UNKNOWN);

const BRACKETED = /[([]([^)\]]*)[)\]]/gu;
/** A note after a dash, as Spotify writes them ("Song - Live", "Song - From \"Film\""). */
const DASHED = /\s+[-–—]\s+(.+)$/u;
/** A guest credit: "(feat. B)", "(with B)", and Spotify's "(with B & C)". */
const GUESTS = /^(?:feat\.?|ft\.?|featuring|with)\s+(.+)$/iu;
const TRAILING_GUESTS = /\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/iu;
/** Where a song comes from ("From \"Black Panther\""), or that it's a bonus track: not another version. */
const PROVENANCE = /^(?:from\b|bonus track$)/iu;
const REMASTER = /\bremaster(?:ed)?\b/iu;
/** Words that make a note another version of the song (as downloads read edition notes). */
const EDITION =
  /\b(?:live|remix|mix|edit|extended|acoustic|instrumental|demo|re[ -]?record(?:ed|ing)?|karaoke|cover|unplugged|session|sped up|slowed|reverb|version|mono|clean|explicit)\b/iu;
const LIVE = /\blive\b/iu;

/** How matching reads a song. */
interface Reading {
  /** Its title without guest credits, provenance, remaster and edition notes. */
  readonly title: string;
  /** Its edition notes, sorted; a live album counts as "live". */
  readonly editions: readonly string[];
  /** Its main artist. */
  readonly main: string;
  /** Everyone credited: its artists and the guests its title names. */
  readonly credited: ReadonlySet<string>;
  /** The guests its title names. */
  readonly guests: readonly string[];
  readonly durationMs: number | null;
}

/**
 * [song] as matching compares it. A note naming only artists either side
 * credits ("(Lil Baby & Gunna)") is a credit too, so [otherArtists] are
 * those of the song it's compared with.
 */
const reading = (
  song: Pick<YtSong, "title" | "artists" | "album" | "durationMs">,
  otherArtists: readonly string[],
): Reading => {
  const artists = artistNames(song.artists);
  const known = new Set([...artists, ...artistNames(otherArtists)]);
  const guests: string[] = [];
  const editions: string[] = [];
  /** Whether [note] stays part of the title; otherwise it's noted as what it is. */
  const stays = (note: string): boolean => {
    const trimmed = note.trim();
    const guest = GUESTS.exec(trimmed)?.[1];
    if (guest !== undefined) {
      guests.push(...artistNames([guest]));
      return false;
    }
    if (PROVENANCE.test(trimmed)) return false;
    if (REMASTER.test(trimmed) && !EDITION.test(trimmed)) return false;
    if (EDITION.test(trimmed)) {
      editions.push(fold(trimmed));
      return false;
    }
    const named = artistNames([trimmed]);
    return !(named.length > 0 && named.every((name) => known.has(name)));
  };
  const title = song.title
    .replace(BRACKETED, (whole, note: string) => (stays(note) ? whole : " "))
    .replace(DASHED, (whole, note: string) => (stays(note) ? whole : ""))
    .replace(TRAILING_GUESTS, (_, named: string) => {
      guests.push(...artistNames([named]));
      return "";
    });
  if (LIVE.test(song.album ?? "") && !editions.some((note) => LIVE.test(note))) {
    editions.push("live");
  }
  return {
    title: fold(title),
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    editions: [...new Set(editions)].sort(),
    main: artists[0] ?? "",
    credited: new Set([...artists, ...guests]),
    guests,
    durationMs: song.durationMs !== null && song.durationMs > 0 ? song.durationMs : null,
  };
};

/** Whether two readings are one recording. */
const sameRecording = (wanted: Reading, found: Reading): boolean =>
  wanted.durationMs !== null &&
  found.durationMs !== null &&
  Math.abs(wanted.durationMs - found.durationMs) <= SAME_LENGTH_MS &&
  wanted.title !== "" &&
  wanted.title === found.title &&
  found.credited.has(wanted.main) &&
  wanted.credited.has(found.main) &&
  wanted.editions.join("\n") === found.editions.join("\n") &&
  wanted.guests.every((guest) => found.credited.has(guest)) &&
  found.guests.every((guest) => wanted.credited.has(guest));

// ---------------------------------------------------------------------------
// Finding a playlist's songs

/** Where a Spotify song was found: the Library's track, a YouTube Music song, or nowhere. */
export type SpotifyFind<S extends YtSong> =
  | { readonly kind: "library"; readonly trackId: number }
  | { readonly kind: "ytMusic"; readonly song: S }
  | { readonly kind: "notFound" };

/** A YouTube Music Songs search's answer, or why there wasn't one. */
export type YtSongSearch<S extends YtSong> =
  | { readonly ok: true; readonly songs: readonly S[] }
  | { readonly ok: false; readonly reason: YtQuietReason | "disabled" };

/** Why finding stopped: offline, YouTube Music kept refusing, it was turned off, or cancelled. */
export type SpotifyFindFailure = YtQuietReason | "disabled" | "cancelled";

export type SpotifyFinding<S extends YtSong> =
  | { readonly ok: true; readonly found: readonly SpotifyFind<S>[] }
  | { readonly ok: false; readonly reason: SpotifyFindFailure };

/**
 * How many YouTube Music searches run at once. Measured from a PC on
 * 2026-10-14: four at once searched a 495-song playlist in 85 seconds (about
 * 6 a second) with no refusals. YouTube Music began refusing some (HTTP 403,
 * about one in eight, never more than three in a row) only after about 2,300
 * searches in 15 minutes, and kept refusing a few for over half an hour.
 */
export const SPOTIFY_SEARCHES_AT_ONCE = 4;

/**
 * The pauses before asking a refused search again; refused once more after
 * the last, finding stops. While refusing, YouTube Music answered every
 * search by the third try.
 */
const RETRY_PAUSES_MS = [2000, 5000, 10_000, 20_000] as const;

const NOT_FOUND: SpotifyFind<never> = { kind: "notFound" };

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Finds each of [songs] in the Library first (`libraryFinder`, as Search
 * and Discover decide), then the rest on YouTube Music: one Songs search per
 * song (its title and artists, `spotifySearchQuery`; a song listed twice is
 * searched once, and a song with no artist isn't searched), the result that
 * is the same recording taken (`spotifyYtMatch`). At most
 * `SPOTIFY_SEARCHES_AT_ONCE` searches run at once. A refused search is asked
 * again after 2, 5, 10 and 20 seconds; refused a fifth time, or offline, finding
 * stops. [onProgress] hears how many songs are settled, the Library's at
 * once. Once [signal] is aborted nothing more is asked.
 */
export const findSpotifySongs = async <
  S extends YtSong,
  L extends LibrarySongKey & { readonly id: number },
>({
  songs,
  library,
  search,
  onProgress,
  signal,
  wait = pause,
}: {
  readonly songs: readonly SpotifySong[];
  readonly library: readonly L[];
  readonly search: (query: string) => Promise<YtSongSearch<S>>;
  readonly onProgress?: (done: number, total: number) => void;
  readonly signal?: AbortSignal;
  readonly wait?: (ms: number) => Promise<void>;
}): Promise<SpotifyFinding<S>> => {
  const inLibrary = libraryFinder(library);
  const found: (SpotifyFind<S> | undefined)[] = songs.map((song) => {
    const track = inLibrary(song);
    if (track !== null) return { kind: "library", trackId: track.id };
    return artistNames(song.artists).length === 0 ? NOT_FOUND : undefined;
  });
  const searches = new Map<string, number[]>();
  found.forEach((find, index) => {
    const song = songs[index];
    if (find !== undefined || song === undefined) return;
    const query = spotifySearchQuery(song);
    searches.set(query, [...(searches.get(query) ?? []), index]);
  });
  const queue = [...searches];
  let done = found.filter((find) => find !== undefined).length;
  onProgress?.(done, songs.length);

  let stopped: SpotifyFindFailure | null = null;
  const cancelled = () => signal?.aborted === true;

  const ask = async (query: string): Promise<YtSongSearch<S> | null> => {
    for (let attempt = 0; ; attempt += 1) {
      const answer = await search(query);
      if (answer.ok || answer.reason !== "failed") return answer;
      const before = RETRY_PAUSES_MS[attempt];
      if (before === undefined) return answer;
      await wait(before);
      if (cancelled() || stopped !== null) return null;
    }
  };

  const work = async (): Promise<void> => {
    while (stopped === null) {
      if (cancelled()) {
        stopped = "cancelled";
        return;
      }
      const next = queue.shift();
      if (next === undefined) return;
      const [query, indexes] = next;
      const answer = await ask(query);
      if (cancelled()) stopped ??= "cancelled";
      if (answer === null || stopped !== null) return;
      if (!answer.ok) {
        stopped = answer.reason;
        return;
      }
      for (const index of indexes) {
        const song = songs[index];
        const match = song === undefined ? null : spotifyYtMatch(song, answer.songs);
        found[index] = match === null ? NOT_FOUND : { kind: "ytMusic", song: match };
      }
      done += indexes.length;
      onProgress?.(done, songs.length);
    }
  };

  await Promise.all(Array.from({ length: SPOTIFY_SEARCHES_AT_ONCE }, work));
  if (stopped !== null) return { ok: false, reason: stopped };
  return { ok: true, found: found.map((find) => find ?? NOT_FOUND) };
};

/**
 * What importing [playlist] makes, given where each of its songs was found
 * ([found], in its order, as `findSpotifySongs` gives them): the songs found,
 * in Spotify's order, the Library's as its tracks and the rest as YT Music
 * entries; a song found twice goes in once (`planPlaylistSongs`). The songs
 * found nowhere are left out and named in [LinkImportPlan.notFound].
 */
export const planSpotifyImport = <S extends YtSong>(
  playlist: SpotifyPlaylist,
  found: readonly SpotifyFind<S>[],
): LinkImportPlan<S> => {
  const given: PlaylistSong<S>[] = [];
  const notFound: NotFoundSong[] = [];
  playlist.songs.forEach((song, index) => {
    const find = found[index];
    if (find?.kind === "library") given.push({ source: "library", trackId: find.trackId });
    else if (find?.kind === "ytMusic") given.push({ source: "stream", song: find.song });
    else notFound.push({ title: song.title, artist: joinArtists(song.artists) });
  });
  const songs = planPlaylistSongs([], given).add;
  return {
    name: importedPlaylistName(playlist.title),
    songs,
    inLibrary: songs.filter((song) => song.source === "library").length,
    notFound,
  };
};

/**
 * The YouTube Music result that is [song]'s recording, the first in
 * YouTube Music's order; null when none is. By the rules downloads use: the
 * same title once guest credits and notes are set aside, each side's main
 * artist credited on the other (credits split as the Library splits them,
 * "The" aside), the same edition notes (a live version, a remix or another
 * edit isn't the song; a remaster note, an album's edition, a soundtrack's
 * "From …" doesn't count), no guest either side doesn't credit, and both
 * lengths known and within 3 seconds.
 */
export const spotifyYtMatch = <S extends YtSong>(
  song: SpotifySong,
  results: readonly S[],
): S | null => {
  if (artistNames(song.artists).length === 0) return null;
  return (
    results.find((result) =>
      sameRecording(reading(song, result.artists), reading(result, song.artists)),
    ) ?? null
  );
};
