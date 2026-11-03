/**
 * Importing a Spotify playlist (docs/spec.md, "Importing playlists from a
 * link"): what a song is searched for on YouTube Music, and which result is
 * the song. The import itself goes on in `playlistImport.ts`.
 */

import { splitCredit } from "./credits.ts";
import { UNKNOWN_ARTIST } from "./library.ts";
import { normalizeSearchText } from "./search.ts";
import type { SpotifySong } from "./spotifyPlaylist.ts";
import { recordingMatches, joinArtists, type YtSong } from "./ytMusic.ts";
import type { YtQuietReason } from "./ytSearch.ts";

/** A YouTube Music Songs search's answer, or why there wasn't one. */
export type YtSongSearch<S extends YtSong> =
  | { readonly ok: true; readonly songs: readonly S[] }
  | { readonly ok: false; readonly reason: YtQuietReason | "disabled" };

/** What a song is looked up on YouTube Music by: its title and artists, all that is sent. */
export const spotifySearchQuery = (song: SpotifySong): string =>
  [song.title, ...song.artists].join(" ");

/** Lengths this close are one recording (as downloads decide). */
const SAME_LENGTH_MS = 3000;

const fold = normalizeSearchText;
const UNKNOWN = fold(UNKNOWN_ARTIST);
const ARTICLE = /^the /u;

/** The artists [credits] name, split as the Library splits credits, compared folded and without "The". */
export const artistNames = (credits: readonly string[]): string[] =>
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
 * A music video's own presentation note ("Official Music Video", "Official Video", "Official
 * HD Video", "Music Video"). A lyric video, a visualizer or audio isn't the music video, so their
 * notes stay in the title and keep it from matching.
 */
const MUSIC_VIDEO_NOTE = /^(?:official )?(?:(?:hd|4k) )?(?:music )?video(?: (?:hd|4k))?$/iu;

/**
 * [song] as matching compares it. A note naming only artists either side
 * credits ("(Lil Baby & Gunna)") is a credit too, so [otherArtists] are
 * those of the song it's compared with.
 */
const reading = (
  song: Pick<YtSong, "title" | "artists" | "album" | "durationMs">,
  otherArtists: readonly string[],
  video = false,
): Reading => {
  const artists = artistNames(song.artists);
  const known = new Set([...artists, ...artistNames(otherArtists)]);
  const guests: string[] = [];
  const editions: string[] = [];
  /** Whether [note] stays part of the title; otherwise it's noted as what it is. */
  const stays = (note: string): boolean => {
    const trimmed = note.trim();
    if (video && MUSIC_VIDEO_NOTE.test(trimmed)) return false;
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

/** How `sameRecording` bounds the found recording's length. */
interface RecordingBounds {
  /** An official music video: up to 3 seconds shorter or 60 seconds longer. */
  readonly video?: boolean;
  /** A wanted song without a length (Recognize's) matches whatever the found one's. */
  readonly unknownLength?: boolean;
}

/** Whether two readings are one recording. */
const sameRecording = (
  wanted: Reading,
  found: Reading,
  { video = false, unknownLength = false }: RecordingBounds = {},
): boolean =>
  ((unknownLength && wanted.durationMs === null) ||
    (wanted.durationMs !== null &&
      found.durationMs !== null &&
      (video
        ? found.durationMs - wanted.durationMs >= -SAME_LENGTH_MS &&
          found.durationMs - wanted.durationMs <= 60_000
        : Math.abs(wanted.durationMs - found.durationMs) <= SAME_LENGTH_MS))) &&
  wanted.title !== "" &&
  wanted.title === found.title &&
  found.credited.has(wanted.main) &&
  wanted.credited.has(found.main) &&
  wanted.editions.join("\n") === found.editions.join("\n") &&
  wanted.guests.every((guest) => found.credited.has(guest)) &&
  found.guests.every((guest) => wanted.credited.has(guest));

/**
 * The YouTube Music result that is [song]'s recording, the first in
 * YouTube Music's order; null when none is. By the rules downloads use: the
 * same title once guest credits and notes are set aside, each side's main
 * artist credited on the other (credits split as the Library splits them,
 * "The" aside), the same edition notes (a live version, a remix or another
 * edit isn't the song; a remaster note, an album's edition, a soundtrack's
 * "From …" doesn't count), no guest either side doesn't credit, and both
 * lengths known and within 3 seconds. Sharing on Spotify matches Spotify's
 * results by the same rules. When no audio result matches, an OMV may be
 * up to 3 seconds shorter or 60 seconds longer; its music video note is set
 * aside (`MUSIC_VIDEO_NOTE`), a lyric, visualizer or audio note isn't. UGC never matches. `unknownLength` is only for Recognize.
 */
export const spotifyYtMatch = <
  S extends Pick<YtSong, "title" | "artists" | "album" | "durationMs"> & {
    readonly videoType?: string | null;
  },
>(
  song: SpotifySong,
  results: readonly S[],
  unknownLength = false,
): S | null => {
  if (artistNames(song.artists).length === 0) return null;
  return (
    results.find(
      (result) =>
        result.videoType !== "MUSIC_VIDEO_TYPE_OMV" &&
        result.videoType !== "MUSIC_VIDEO_TYPE_UGC" &&
        sameRecording(reading(song, result.artists), reading(result, song.artists), {
          unknownLength,
        }),
    ) ??
    results.find(
      (result) =>
        result.videoType === "MUSIC_VIDEO_TYPE_OMV" &&
        sameRecording(reading(song, result.artists), reading(result, song.artists, true), {
          video: true,
          unknownLength,
        }),
    ) ??
    null
  );
};

/** Songs first, then one Videos search. Failed searches never settle an entry as not found.
 * Recognize has no length; it uses the same identity checks without a duration bound.
 */
export const searchRecording = async <S extends YtSong>(
  song: SpotifySong,
  search: (kind: "songs" | "videos") => Promise<YtSongSearch<S> | null>,
  unknownLength = false,
): Promise<YtSongSearch<S> | null> => {
  const songs = await search("songs");
  if (songs === null || !songs.ok) return songs;
  const audio = unknownLength
    ? (songs.songs.find(
        (candidate) =>
          candidate.videoType !== "MUSIC_VIDEO_TYPE_UGC" &&
          candidate.videoType !== "MUSIC_VIDEO_TYPE_OMV" &&
          recordingMatches(
            {
              title: candidate.title,
              artist: joinArtists(candidate.artists),
              durationMs: candidate.durationMs ?? 0,
            },
            song,
          ),
      ) ?? spotifyYtMatch(song, songs.songs, true))
    : spotifyYtMatch(song, songs.songs);
  if (audio !== null) return { ok: true, songs: [audio] };
  const videos = await search("videos");
  if (videos === null || !videos.ok) return videos;
  const video = spotifyYtMatch(
    song,
    videos.songs.filter((s) => s.videoType === "MUSIC_VIDEO_TYPE_OMV"),
    unknownLength,
  );
  return { ok: true, songs: video === null ? [] : [video] };
};
