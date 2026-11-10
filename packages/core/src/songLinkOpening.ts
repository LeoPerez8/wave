/**
 * Opening a song link (docs/spec.md, "Opening a song link"): which links name
 * a song Wave can play, which copy of it plays (the Library's, else YouTube
 * Music's stream, else none), and what a link that plays nothing says.
 */

import { splitCredit } from "./credits.ts";
import { linkParts, addressIn, isSpotifyId, queryValue, spotifyAddress } from "./linkText.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { streamedSongMagicStart, type MagicSeed } from "./magicQueue.ts";
import type { ImportNotice } from "./playlistLinks.ts";
import type { YtSongSearch } from "./spotifyImport.ts";
import type { SpotifyReadFailure, SpotifySong } from "./spotifyPlaylist.ts";
import { joinArtists, type YtSong } from "./ytMusic.ts";

/** A song a link names, as Wave reads it from the link alone. */
export type SongLink =
  | {
      readonly service: "ytMusic";
      /** YouTube's video id: all that is sent. */
      readonly videoId: string;
    }
  | {
      readonly service: "spotify";
      /** Spotify's track id: all that is sent to Spotify. */
      readonly trackId: string;
    }
  /**
   * A Spotify short link (`spotify.link/<code>`), which names a song or a
   * playlist only once followed (`spotifyShortLinkLanding`).
   */
  | { readonly service: "spotifyShort"; readonly url: string };

const YT_MUSIC_HOST = "music.youtube.com";
/** What a YouTube video id is: 11 letters, digits, `-` and `_`. */
const VIDEO_ID = /^[\w-]{11}$/u;

/** The song a Spotify link names: a track's page or URI, or a short link to follow. */
const spotifySong = (link: string): SongLink | null => {
  const spotify = spotifyAddress(link);
  if (spotify?.at === "short") return { service: "spotifyShort", url: spotify.url };
  return spotify?.at === "page" && spotify.kind === "track" && isSpotifyId(spotify.id)
    ? { service: "spotify", trackId: spotify.id }
    : null;
};

/**
 * The song [text] names: the first web address or Spotify URI in it
 * (punctuation after it dropped), else the whole text as a link without its
 * scheme. A YouTube Music song link is `music.youtube.com/watch?v=<id>`, its
 * other parameters ignored, a playlist's `list=` too. A Spotify one is a
 * track's page (`open.spotify.com/track/<id>`, after a locale or `/embed`,
 * parameters ignored), its URI (`spotify:track:<id>`), or a short link
 * (`spotify.link/<code>`), which is followed before Wave knows it's a song.
 * Null for anything else, plain YouTube links included.
 */
export const recogniseSongLink = (text: string): SongLink | null => {
  const link = addressIn(text) ?? text.trim();
  const spotify = spotifySong(link);
  if (spotify !== null) return spotify;
  const parts = linkParts(link);
  if (parts === null || parts.host !== YT_MUSIC_HOST || parts.path !== "/watch") return null;
  const videoId = queryValue(parts.query, "v");
  return videoId !== null && VIDEO_ID.test(videoId) ? { service: "ytMusic", videoId } : null;
};

/**
 * A song a link named, as its service describes it: what the Library's copy
 * is looked for by, and what a song that isn't found shows. A YT Music song
 * is one; another service's track, read from its page, is one too.
 */
export interface LinkedSong {
  readonly title: string;
  readonly artists: readonly string[];
  /** Null when the service doesn't say. */
  readonly durationMs: number | null;
  readonly artworkUrl: string | null;
  /** The YouTube video id the link named, when it was YouTube Music's. */
  readonly videoId: string | null;
}

/**
 * The YT Music song a link's video [videoId] names, from the first page of
 * its radio ([radio]), which YouTube Music starts with the song itself. Null
 * when the radio doesn't start with it: YouTube Music can't play that video.
 */
export const linkedYtSong = <S extends YtSong>(videoId: string, radio: readonly S[]): S | null =>
  radio[0]?.videoId === videoId ? radio[0] : null;

/** A Library song as a song link plays it. */
interface LibraryCopy {
  readonly id: number;
  readonly title: string;
  /** Null for a song with no file on this phone. */
  readonly path: string | null;
}

/**
 * The Library's copy of a linked [song] that plays here, or null: the song
 * downloaded from the link's own video ([stored]), else the same recording
 * as Search finds it ([find], `libraryFinder` over its title, artists and
 * length). A Library song with no file on this phone isn't one.
 */
export const songLinkLibraryCopy = <K extends LinkedSong, L extends LibraryCopy>(
  song: K,
  { stored, find }: { readonly stored: L | null; readonly find: (song: K) => L | null },
): L | null => {
  if (stored?.path != null) return stored;
  const found = find(song);
  return found?.path != null ? found : null;
};

/** What a song link plays (`songLinkPlay`). */
export type SongLinkPlay<S, L> =
  /** The Library's file, as the Magic Queue its own menu starts. */
  | {
      readonly play: "magicQueue";
      readonly from: "library";
      readonly seed: MagicSeed;
      readonly track: L;
    }
  /** YouTube Music's stream, as its Magic Queue (`startStreamedMagicQueue`). */
  | { readonly play: "magicQueue"; readonly from: "stream"; readonly song: S }
  /** No same recording in the Library or online: nothing plays. */
  | { readonly play: "notFound"; readonly song: LinkedSong };

/**
 * What the song a link named ([song]) plays: a Magic Queue seeded by it, from
 * the Library's copy ([copy], `songLinkLibraryCopy`) when there is one, else
 * from YouTube Music's same recording ([stream]: the link's own song, or
 * another service's track as found on YouTube Music). With neither, it isn't
 * found, and nothing near it plays.
 */
export const songLinkPlay = <S extends YtSong, L extends LibraryCopy>(
  song: LinkedSong,
  copy: L | null,
  stream: S | null,
): SongLinkPlay<S, L> => {
  const start = streamedSongMagicStart(copy);
  if (start.from === "library") return { play: "magicQueue", ...start };
  return stream === null
    ? { play: "notFound", song }
    : { play: "magicQueue", from: "stream", song: stream };
};

/** A service whose song links Wave reads the track from (its page or API). */
export type TrackService = "spotify";

/**
 * Why a song link plays nothing: no network, a video YouTube Music can't play
 * or no answer from it, YT Music turned off, a song that isn't found, no
 * answer to YouTube Music's search for another service's track, the track
 * not read from its service (`unread`), or a short link that names no song
 * or playlist (`cantOpen`).
 */
export type SongLinkFailure =
  | "offline"
  | "failed"
  | "unplayable"
  | "disabled"
  | "searchFailed"
  | "cantOpen"
  | { readonly notFound: Pick<LinkedSong, "title" | "artists"> }
  | { readonly unread: SpotifyReadFailure; readonly service: TrackService };

/** A song another service's link named, as YouTube Music's search would play it, or why nothing plays. */
export type TrackLinkPlay<S, L> =
  | SongLinkPlay<S, L>
  | { readonly play: "failed"; readonly failure: "offline" | "disabled" | "searchFailed" };

/**
 * What a track another service's link names ([song], as read from Spotify's
 * embed page or Deezer's API) plays: the Library's same recording ([find],
 * `libraryFinder` over its title, artists and length), else YouTube Music's
 * same recording, searched for once ([search]: Songs, then the official
 * video, as imports match, `searchRecording`), as its Magic Queue. When
 * neither has it, it isn't found and nothing near it plays. A search with no
 * answer (offline, YT Music off meanwhile, or failed) plays nothing either.
 */
export const trackLinkPlay = async <S extends YtSong, L extends LibraryCopy>(
  song: SpotifySong,
  {
    find,
    search,
  }: {
    readonly find: (song: LinkedSong) => L | null;
    readonly search: (song: SpotifySong) => Promise<YtSongSearch<S> | null>;
  },
): Promise<TrackLinkPlay<S, L>> => {
  const linked: LinkedSong = {
    title: song.title,
    artists: song.artists,
    durationMs: song.durationMs,
    artworkUrl: song.artworkUrl ?? null,
    videoId: null,
  };
  const copy = songLinkLibraryCopy(linked, { stored: null, find });
  if (copy !== null) return songLinkPlay<S, L>(linked, copy, null);
  const found = await search(song);
  if (found === null) return { play: "failed", failure: "searchFailed" };
  if (!found.ok)
    return { play: "failed", failure: found.reason === "failed" ? "searchFailed" : found.reason };
  return songLinkPlay<S, L>(linked, null, found.songs[0] ?? null);
};

/** How a track service is named in messages: a brand, the same in every language. */
const TRACK_SERVICE_NAMES: Readonly<Record<TrackService, string>> = { spotify: "Spotify" };

/** The short message a song link that plays nothing shows, in [language]. */
export const songLinkNotice = (
  failure: SongLinkFailure,
  language: AppLanguage = "en",
): ImportNotice => {
  const text = catalogueOf(language).imports;
  if (typeof failure === "object") {
    if ("notFound" in failure)
      return {
        title: text.songNotFound,
        message: `${failure.notFound.title} · ${joinArtists(failure.notFound.artists)}`,
      };
    const service = TRACK_SERVICE_NAMES[failure.service];
    const unread = {
      missing: text.songUnreadMissing,
      unreachable: text.songUnreadUnreachable,
      failed: text.songUnreadFailed,
    }[failure.unread];
    return { title: text.songLinkDoesntOpen, message: unread(service) };
  }
  switch (failure) {
    case "offline":
      return { title: text.songOffline, message: text.songOfflineMessage };
    case "disabled":
      return { title: text.ytMusicOff, message: text.ytMusicOffMessage };
    case "failed":
    case "unplayable":
      return { title: text.songLinkDoesntOpen, message: text.songLinkDoesntOpenMessage };
    case "searchFailed":
      return { title: text.songLinkDoesntOpen, message: text.songSearchFailedMessage };
    case "cantOpen":
      return { title: text.cantOpen, message: text.sharedLinks };
  }
};

/** The Couldn't find card, for a song a link named that plays from nowhere. */
export interface SongLinkNotFound {
  readonly heading: string;
  readonly title: string;
  /** Its artists as one credit. */
  readonly artists: string;
  /** The cover its service gave, when it gave one. */
  readonly artworkUrl: string | null;
  /** What its Search button types into Search: its title and main artist. Null with no Search tab. */
  readonly searchQuery: string | null;
}

/**
 * The Couldn't find card for [song], in [language]: "Couldn't find this song
 * online", its title, artists and cover, and, when the tab bar has Search
 * ([search]), a Search button that opens it with the song's title and main
 * artist (the first its credits name) typed in. Any service's song link that
 * isn't found shows it.
 */
export const songLinkNotFound = (
  song: LinkedSong,
  { search }: { readonly search: boolean },
  language: AppLanguage = "en",
): SongLinkNotFound => {
  const main = song.artists.flatMap((credit) => splitCredit(credit))[0];
  return {
    heading: catalogueOf(language).imports.songNotFound,
    title: song.title,
    artists: joinArtists(song.artists),
    artworkUrl: song.artworkUrl,
    searchQuery: !search ? null : main === undefined ? song.title : `${song.title} ${main}`,
  };
};
