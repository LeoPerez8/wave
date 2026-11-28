/**
 * Opening a song link (docs/spec.md, "Opening a song link"): which links name
 * a song Wave can play, which copy of it plays (the Library's, else YouTube
 * Music's stream, else none), and what a link that plays nothing says.
 */

import { splitCredit } from "./credits.ts";
import {
  addressIn,
  deezerAddress,
  isDeezerId,
  isSpotifyId,
  linkParts,
  queryValue,
  spotifyAddress,
  type LinkParts,
} from "./linkText.ts";
import { cantOpenNotice, ytMusicOffNotice, type ImportNotice } from "./linkNotices.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { streamedSongMagicStart, type MagicSeed } from "./magicQueue.ts";
import type { ServiceTrack, TrackReadFailure } from "./serviceTrack.ts";
import type { YtSongSearch } from "./spotifyImport.ts";
import { joinArtists, type YtSong } from "./ytMusic.ts";

/**
 * A song a link names, as Wave reads it from the link alone, or an album or
 * artist, which opens on its YT Music page instead of playing.
 */
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
  | { readonly service: "spotifyShort"; readonly url: string }
  | {
      readonly service: "spotifyAlbum";
      /** Spotify's album id: all that is sent to Spotify. */
      readonly albumId: string;
    }
  | {
      readonly service: "deezer";
      /** Deezer's track id (digits): all that is sent to Deezer. */
      readonly trackId: string;
    }
  /**
   * A Deezer short link (`link.deezer.com/s/<code>`, `deezer.page.link/<code>`),
   * which names a song only once followed (`deezerShortLinkLanding`).
   */
  | { readonly service: "deezerShort"; readonly url: string }
  /** A YouTube Music album's page, opened as it is. */
  | {
      readonly service: "ytAlbum";
      /** The album's browse id (`MPREb_…`). */
      readonly browseId: string;
    }
  /** A YouTube Music album's own playlist, opened as the album its songs name. */
  | {
      readonly service: "ytAlbumPlaylist";
      /** The album's playlist id (`OLAK5uy_…`): all that is sent. */
      readonly playlistId: string;
    }
  /** A YouTube or YouTube Music channel, opened as that YT Music artist. */
  | {
      readonly service: "ytArtist";
      /** The channel id (`UC…`): all that is sent. */
      readonly channelId: string;
    }
  /** A Spotify artist, looked for on YouTube Music by the name Spotify gives. */
  | {
      readonly service: "spotifyArtist";
      /** Spotify's artist id: all that is sent to Spotify. */
      readonly artistId: string;
    }
  /** A Deezer artist, looked for on YouTube Music by the name Deezer gives. */
  | {
      readonly service: "deezerArtist";
      /** Deezer's artist id (digits): all that is sent to Deezer. */
      readonly artistId: string;
    };

const YT_MUSIC_HOST = "music.youtube.com";
/** YouTube's hosts, YouTube Music's among them. */
const YOUTUBE_HOSTS = new Set([
  "music.youtube.com",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);
/** YouTube's short links, which only ever name a video. */
const YOUTU_BE = "youtu.be";
/** What a YouTube video id is: 11 letters, digits, `-` and `_`. */
const VIDEO_ID = /^[\w-]{11}$/u;
/** A Short's page, `/shorts/<id>`. */
const SHORTS_PATH = /^\/shorts\/([\w-]{11})\/?$/u;
/** A `youtu.be` link's path, `/<id>`. */
const YOUTU_BE_PATH = /^\/([\w-]{11})\/?$/u;

/** An album's page on YouTube Music, `/browse/MPREb_…`. */
const ALBUM_PATH = /^\/browse\/(MPREb_[\w-]+)\/?$/u;
/** An album's own playlist id, `OLAK5uy_…`. */
const ALBUM_PLAYLIST_ID = /^OLAK5uy_[\w-]{10,}$/u;
/** A channel's page, `/channel/UC…` (a channel id is `UC` and 22 more). */
const CHANNEL_PATH = /^\/channel\/(UC[\w-]{22})\/?$/u;

/** The video a YouTube `watch` link or Short names, or null. */
const youtubeVideo = (parts: LinkParts): string | null => {
  if (parts.path !== "/watch") return SHORTS_PATH.exec(parts.path)?.[1] ?? null;
  const videoId = queryValue(parts.query, "v");
  return videoId !== null && VIDEO_ID.test(videoId) ? videoId : null;
};

/**
 * What a YouTube or YouTube Music link names: a video (`watch?v=`, a Short,
 * `youtu.be`), an album's page (`/browse/MPREb_…`, YouTube Music's only) or
 * playlist (`/playlist?list=OLAK5uy_…`), or a channel (`/channel/UC…`).
 */
const youtubeLink = (parts: LinkParts): SongLink | null => {
  if (parts.host === YOUTU_BE) {
    const videoId = YOUTU_BE_PATH.exec(parts.path)?.[1];
    return videoId === undefined ? null : { service: "ytMusic", videoId };
  }
  if (!YOUTUBE_HOSTS.has(parts.host)) return null;
  const videoId = youtubeVideo(parts);
  if (videoId !== null) return { service: "ytMusic", videoId };
  const browseId = parts.host === YT_MUSIC_HOST ? ALBUM_PATH.exec(parts.path)?.[1] : undefined;
  if (browseId !== undefined) return { service: "ytAlbum", browseId };
  const list = parts.path === "/playlist" ? queryValue(parts.query, "list") : null;
  if (list !== null && ALBUM_PLAYLIST_ID.test(list))
    return { service: "ytAlbumPlaylist", playlistId: list };
  const channelId = CHANNEL_PATH.exec(parts.path)?.[1];
  return channelId === undefined ? null : { service: "ytArtist", channelId };
};

/** The song a Spotify link names: a track's or album's page or URI, or a short link to follow. */
const spotifySong = (link: string): SongLink | null => {
  const spotify = spotifyAddress(link);
  if (spotify?.at === "short") return { service: "spotifyShort", url: spotify.url };
  if (spotify?.at !== "page" || !isSpotifyId(spotify.id)) return null;
  if (spotify.kind === "track") return { service: "spotify", trackId: spotify.id };
  if (spotify.kind === "album") return { service: "spotifyAlbum", albumId: spotify.id };
  return spotify.kind === "artist" ? { service: "spotifyArtist", artistId: spotify.id } : null;
};

/**
 * The track or artist a Deezer short link (`deezerShort`) names once
 * followed: where following it landed ([url]), a track's or artist's page on
 * deezer.com (its locale and parameters ignored). Null anywhere else: an
 * album, a playlist, an episode, or Deezer's page for a dead link
 * (`deezer-links-404`).
 */
export const deezerShortLinkLanding = (
  url: string,
): Extract<SongLink, { readonly service: "deezer" | "deezerArtist" }> | null => {
  const page = deezerAddress(url);
  if (page?.at !== "page" || !isDeezerId(page.id)) return null;
  if (page.kind === "track") return { service: "deezer", trackId: page.id };
  return page.kind === "artist" ? { service: "deezerArtist", artistId: page.id } : null;
};

/** The song a Deezer link names: a track's page, or a short link to follow. */
const deezerSong = (link: string): SongLink | null => {
  const deezer = deezerAddress(link);
  return deezer?.at === "short"
    ? { service: "deezerShort", url: deezer.url }
    : deezerShortLinkLanding(link);
};

/**
 * The song, album or artist [text] names: the first web address or Spotify
 * URI in it (punctuation after it dropped), else the whole text as a link
 * without its scheme. A YouTube song link is a video, on YouTube Music or
 * YouTube (`watch?v=<id>` on any of its hosts, a Short, `youtu.be/<id>`), its
 * other parameters ignored, a playlist's `list=` too. A YouTube Music album
 * is its page (`music.youtube.com/browse/MPREb_…`) or its playlist
 * (`/playlist?list=OLAK5uy_…`, YouTube's host too), and a channel
 * (`/channel/UC…`) is an artist. A Spotify one is a track's page
 * (`open.spotify.com/track/<id>`, after a locale or `/embed`, parameters
 * ignored), its URI (`spotify:track:<id>`), an album's or artist's page or URI
 * (`open.spotify.com/album/<id>`, `spotify:artist:<id>`), or a short link
 * (`spotify.link/<code>`), which is followed before Wave knows what it names.
 * A Deezer one is a track's or artist's page (`deezer.com/track/<id>`, after
 * a locale, parameters ignored, the id digits) or a short link
 * (`link.deezer.com/s/<code>`, `deezer.page.link/<code>`), followed first
 * too. Null for anything else: a YouTube handle (`@name`), Deezer albums and
 * playlists, playlists Wave imports instead.
 */
export const recogniseSongLink = (text: string): SongLink | null => {
  const link = addressIn(text) ?? text.trim();
  const song = spotifySong(link) ?? deezerSong(link);
  if (song !== null) return song;
  const parts = linkParts(link);
  return parts === null ? null : youtubeLink(parts);
};

/** What a link opens: a song that plays, or an album's or artist's page. */
export type SongLinkKind = "song" | "album" | "artist";

/**
 * What [link] opens: a song, an album (a YT Music album's page or playlist, a
 * Spotify album) or an artist (a YouTube channel, a Spotify or Deezer
 * artist). A short link counts as a song until it's followed.
 */
export const songLinkKind = (link: SongLink): SongLinkKind => {
  switch (link.service) {
    case "ytAlbum":
    case "ytAlbumPlaylist":
    case "spotifyAlbum":
      return "album";
    case "ytArtist":
    case "spotifyArtist":
    case "deezerArtist":
      return "artist";
    default:
      return "song";
  }
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

/** What a YouTube Music song link plays, or why nothing does (`ytMusicLinkPlay`). */
export type YtMusicLinkPlay<S, L> =
  | SongLinkPlay<S, L>
  | { readonly play: "failed"; readonly failure: "offline" | "disabled" | "failed" | "unplayable" };

/**
 * What the YouTube Music song link to [videoId] plays. The Library's song
 * downloaded from that video ([stored]) plays first, with nothing asked of
 * YouTube Music. Otherwise YouTube Music is asked for the song's radio
 * ([radio], its first page; null when it threw), whose first song is the
 * song itself (`linkedYtSong`): the Library's same recording ([find],
 * `libraryFinder` over its title, artists and length) plays, else the YT
 * Music song streams, each as its Magic Queue. A radio that doesn't start
 * with the song is a video YouTube Music can't play (`unplayable`); no answer
 * says why (`offline`, `disabled`, `failed`).
 */
export const ytMusicLinkPlay = async <S extends YtSong, L extends LibraryCopy>(
  videoId: string,
  {
    stored,
    radio,
    find,
  }: {
    readonly stored: L | null;
    readonly radio: () => Promise<YtSongSearch<S> | null>;
    readonly find: (song: S) => L | null;
  },
): Promise<YtMusicLinkPlay<S, L>> => {
  const start = streamedSongMagicStart(stored);
  if (start.from === "library") return { play: "magicQueue", ...start };
  const answer = await radio();
  if (answer === null) return { play: "failed", failure: "failed" };
  if (!answer.ok) return { play: "failed", failure: answer.reason };
  const song = linkedYtSong(videoId, answer.songs);
  if (song === null) return { play: "failed", failure: "unplayable" };
  return songLinkPlay(song, songLinkLibraryCopy(song, { stored: null, find }), song);
};

/** A service whose song links Wave reads the track from (its page or API). */
export type TrackService = "spotify" | "deezer";

/**
 * Why a song link plays nothing: no network, no answer from YouTube Music
 * (to a link's radio or to the search for another service's track,
 * `failed`), a video YouTube Music can't play (`unplayable`), YT Music turned
 * off, a song that isn't found, the track not read from its service
 * (`unread`), or a short link that names no song or playlist (`cantOpen`).
 * An album link has its own: offline, not on YouTube Music, and its page
 * not read (`unread` with `album`); so does an artist link (`artistOffline`,
 * `artistNotFound`, `unread` with `artist`).
 */
export type SongLinkFailure =
  | "offline"
  | "albumOffline"
  | "artistOffline"
  | "failed"
  | "unplayable"
  | "disabled"
  | "cantOpen"
  | { readonly notFound: Pick<LinkedSong, "title" | "artists"> }
  | { readonly albumNotFound: { readonly title: string; readonly artists: readonly string[] } }
  /** No YT Music artist for the link: by the name its service gave, or a channel (no name). */
  | { readonly artistNotFound: { readonly name: string | null } }
  | {
      readonly unread: TrackReadFailure;
      readonly service: TrackService;
      readonly album?: true;
      readonly artist?: true;
    };

/** A song another service's link named, as YouTube Music's search would play it, or why nothing plays. */
export type TrackLinkPlay<S, L> =
  | SongLinkPlay<S, L>
  | { readonly play: "failed"; readonly failure: "offline" | "disabled" | "failed" };

/**
 * What a track another service's link names ([song], as read from Spotify's
 * embed page or Deezer's API, `readDeezerTrack`) plays: the Library's same recording ([find],
 * `libraryFinder` over its title, artists and length), else YouTube Music's
 * same recording, searched for once ([search]: Songs, then the official
 * video, as imports match, `searchRecording`), as its Magic Queue. When
 * neither has it, it isn't found and nothing near it plays. A search with no
 * answer (offline, YT Music off meanwhile, or failed) plays nothing either.
 */
export const trackLinkPlay = async <S extends YtSong, L extends LibraryCopy>(
  song: ServiceTrack,
  {
    find,
    search,
  }: {
    readonly find: (song: LinkedSong) => L | null;
    readonly search: (song: ServiceTrack) => Promise<YtSongSearch<S> | null>;
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
  if (found === null) return { play: "failed", failure: "failed" };
  if (!found.ok) return { play: "failed", failure: found.reason };
  return songLinkPlay<S, L>(linked, null, found.songs[0] ?? null);
};

/** How a track service is named in messages: a brand, the same in every language. */
const TRACK_SERVICE_NAMES: Readonly<Record<TrackService, string>> = {
  spotify: "Spotify",
  deezer: "Deezer",
};

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
    if ("albumNotFound" in failure)
      return {
        title: text.albumNotFound,
        message: `${failure.albumNotFound.title} · ${joinArtists(failure.albumNotFound.artists)}`,
      };
    if ("artistNotFound" in failure)
      return {
        title: text.artistNotFound,
        message: failure.artistNotFound.name ?? text.artistChannelNotFound,
      };
    const service = TRACK_SERVICE_NAMES[failure.service];
    const missing =
      failure.album === true
        ? text.albumUnreadMissing
        : failure.artist === true
          ? text.artistUnreadMissing
          : text.songUnreadMissing;
    const unread = {
      missing,
      unreachable: text.songUnreadUnreachable,
      failed: text.songUnreadFailed,
    }[failure.unread];
    return { title: text.songLinkDoesntOpen, message: unread(service) };
  }
  switch (failure) {
    case "offline":
      return { title: text.songOffline, message: text.songOfflineMessage };
    case "albumOffline":
      return { title: text.songOffline, message: text.albumOfflineMessage };
    case "artistOffline":
      return { title: text.songOffline, message: text.artistOfflineMessage };
    case "disabled":
      return ytMusicOffNotice(language);
    case "unplayable":
      return { title: text.songLinkDoesntOpen, message: text.songLinkDoesntOpenMessage };
    case "failed":
      return { title: text.songLinkDoesntOpen, message: text.ytMusicNoAnswerMessage };
    case "cantOpen":
      return cantOpenNotice(language);
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
