/**
 * Opening a song link (docs/spec.md, "Opening a song link"): which links name
 * a song Wave can play, which copy of it plays (the Library's, else YouTube
 * Music's stream, else none), and what a link that plays nothing says.
 */

import { linkParts, addressIn, queryValue } from "./linkText.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { streamedSongMagicStart, type MagicSeed } from "./magicQueue.ts";
import type { ImportNotice } from "./playlistLinks.ts";
import { joinArtists, type YtSong } from "./ytMusic.ts";

/** A song a link names, as Wave reads it from the link alone. */
export type SongLink = {
  readonly service: "ytMusic";
  /** YouTube's video id: all that is sent. */
  readonly videoId: string;
};

const YT_MUSIC_HOST = "music.youtube.com";
/** What a YouTube video id is: 11 letters, digits, `-` and `_`. */
const VIDEO_ID = /^[\w-]{11}$/u;

/**
 * The song [text] names: a YouTube Music song link
 * (`music.youtube.com/watch?v=<id>`, with or without the scheme, its other
 * parameters ignored, a playlist's `list=` too): the first web address in
 * it (punctuation after it dropped), else the whole text as a link without
 * its scheme. Null for anything else, plain YouTube links included.
 */
export const recogniseSongLink = (text: string): SongLink | null => {
  const parts = linkParts(addressIn(text) ?? text.trim());
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

/**
 * Why a song link plays nothing: no network, a video YouTube Music can't play
 * or no answer from it, YT Music turned off, or a song that isn't found.
 */
export type SongLinkFailure =
  | "offline"
  | "failed"
  | "unplayable"
  | "disabled"
  | { readonly notFound: Pick<LinkedSong, "title" | "artists"> };

/** The short message a song link that plays nothing shows, in [language]. */
export const songLinkNotice = (
  failure: SongLinkFailure,
  language: AppLanguage = "en",
): ImportNotice => {
  const text = catalogueOf(language).imports;
  if (typeof failure === "object")
    return {
      title: text.songNotFound,
      message: `${failure.notFound.title} · ${joinArtists(failure.notFound.artists)}`,
    };
  switch (failure) {
    case "offline":
      return { title: text.songOffline, message: text.songOfflineMessage };
    case "disabled":
      return { title: text.ytMusicOff, message: text.ytMusicOffMessage };
    case "failed":
    case "unplayable":
      return { title: text.songLinkDoesntOpen, message: text.songLinkDoesntOpenMessage };
  }
};
