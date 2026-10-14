/**
 * Importing a playlist from a link (docs/spec.md, "Importing playlists from
 * a link"): which links Wave can read a playlist from, and what importing
 * the playlist read makes.
 */

import { counted } from "./listening.ts";
import { importedPlaylistName } from "./m3u.ts";
import { planPlaylistSongs, type PlaylistSong } from "./playlistEntries.ts";
import { libraryFinder, type LibrarySongKey, type YtSong } from "./ytMusic.ts";
import type { YtQuietReason } from "./ytSearch.ts";

/** Where Library › Playlists › Import takes a playlist from. */
export type PlaylistImportSource = "link" | "files";

/**
 * What Import offers, in order: From a Link and From Files, or with YT Music
 * off only the files (Import opens the file picker at once, as before links).
 */
export const playlistImportSources = ({
  ytMusic,
}: {
  readonly ytMusic: boolean;
}): readonly PlaylistImportSource[] => (ytMusic ? ["link", "files"] : ["files"]);

/** A playlist Wave can read from its service, as a link names it. */
export type PlaylistLink =
  | {
      readonly service: "ytMusic";
      /** YouTube's playlist id, without `VL`: all that is sent. */
      readonly playlistId: string;
    }
  | {
      readonly service: "spotify";
      /** Spotify's playlist id (22 letters and digits): all that is sent. */
      readonly playlistId: string;
    }
  | {
      /**
       * A Spotify short share link (`spotify.link/<code>`), which names a
       * playlist only once followed (`spotifyShortLinkTarget`).
       */
      readonly service: "spotifyShort";
      /** The link without its parameters: `https://<host>/<code>`. */
      readonly url: string;
    };

/** Why a link names no playlist Wave can read. */
export type PlaylistLinkProblem = "empty" | "notLink" | "otherSite" | "song" | "notPlaylist";

export type PlaylistLinkCheck =
  | { readonly ok: true; readonly link: PlaylistLink }
  | { readonly ok: false; readonly problem: PlaylistLinkProblem; readonly reason: string };

const ASK = "Paste a link to a YouTube Music or Spotify playlist.";

const REASONS: Record<PlaylistLinkProblem, string> = {
  empty: ASK,
  notLink: ASK,
  otherSite: "Wave imports playlists from YouTube Music and Spotify links.",
  song: "This is a link to a song, not a playlist.",
  notPlaylist: "This link isn't to a playlist.",
};

const rejected = (problem: PlaylistLinkProblem): PlaylistLinkCheck => ({
  ok: false,
  problem,
  reason: REASONS[problem],
});

/** `scheme://host/path?query#fragment`, the scheme optional; the host has a dot. */
const LINK = /^(?:https?:\/\/)?([^/?#\s.]+(?:\.[^/?#\s.]+)+)([^?#\s]*)(?:\?([^#\s]*))?(?:#\S*)?$/iu;

/** What a playlist id is made of. */
const ID = /^[\w-]+$/u;

const YOUTUBE_HOSTS = new Set([
  "music.youtube.com",
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
]);
/** YouTube's short links, which only ever name a video. */
const SHORT_HOST = "youtu.be";

/** The value of [name] in a query string, decoded; null when it has none. */
const queryValue = (query: string, name: string): string | null => {
  for (const pair of query.split("&")) {
    const at = pair.indexOf("=");
    if (at >= 0 && pair.slice(0, at) === name) return pair.slice(at + 1);
  }
  return null;
};

/**
 * A playlist id on its own (`list=` before it, or `VL` as in a browse id,
 * allowed): one of YouTube's kinds of playlist, a made playlist (`PL`), an
 * album's (`OLAK5uy_`) or YouTube Music's own (`RDCLAK5uy_`).
 */
const BARE_ID = /^(?:list=)?(?:VL)?((?:PL|OLAK5uy_|RDCLAK5uy_)[\w-]{10,})$/u;

const ytPlaylist = (playlistId: string): PlaylistLinkCheck => ({
  ok: true,
  link: { service: "ytMusic", playlistId },
});

const SPOTIFY_HOST = "open.spotify.com";
/** Spotify's short share links (Branch.io), which only Spotify can follow. */
const SPOTIFY_SHORT_HOSTS = new Set(["spotify.link", "spotify.app.link"]);
/** What every Spotify id is: 22 base-62 characters. */
const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/u;
/** `spotify:playlist:<id>`, also as an old URI with its owner (`spotify:user:<user>:playlist:<id>`). */
const SPOTIFY_URI = /^spotify:(?:user:[^:\s]+:)?([a-z]+):([^:\s]*)$/iu;
/**
 * A path on open.spotify.com: `/<kind>/<id>`, after a locale (`/intl-pt`),
 * the embed player's `/embed` or an old link's `/user/<user>`.
 */
const SPOTIFY_PATH = /^(?:\/intl-[\w-]+)?(?:\/embed)?(?:\/user\/[^/]+)?\/([a-z]+)\/([^/]+)\/?$/iu;
/** The kinds of Spotify page that are one song. */
const SPOTIFY_SONGS = new Set(["track", "episode"]);
/** A short link's code, from its path. */
const SHORT_CODE = /^\/([\w-]+)\/?$/u;

/** What a Spotify `<kind>` and id name. */
const spotifyEntity = (kind: string, id: string): PlaylistLinkCheck => {
  const lower = kind.toLowerCase();
  if (SPOTIFY_SONGS.has(lower)) return rejected("song");
  if (lower !== "playlist" || !SPOTIFY_ID.test(id)) return rejected("notPlaylist");
  return { ok: true, link: { service: "spotify", playlistId: id } };
};

/** A Spotify page's path: its playlist, or why it isn't one. */
const spotifyPath = (path: string): PlaylistLinkCheck => {
  const parts = SPOTIFY_PATH.exec(path);
  return parts === null ? rejected("notPlaylist") : spotifyEntity(parts[1] ?? "", parts[2] ?? "");
};

/** A web address or a Spotify URI among words, as an app shares a link with its title. */
const ADDRESS = /\bhttps?:\/\/\S+|\bspotify:[\w:]+/iu;
/** Punctuation that ends a sentence or closes a bracket or quote, not the address before it. */
const AFTER_ADDRESS = /[.,!?;:'")\]}>»”’]+$/u;

/** The first web address in [text], without the punctuation after it; null when it has none. */
const addressIn = (text: string): string | null => {
  const address = ADDRESS.exec(text)?.[0];
  return address === undefined ? null : address.replace(AFTER_ADDRESS, "");
};

/**
 * The playlist a pasted or shared link names: a YouTube Music or YouTube
 * playlist link (any of YouTube's hosts, extra parameters ignored), a
 * Spotify playlist link (`open.spotify.com/playlist/<id>`, after a locale,
 * `/embed` or an old link's `/user/<user>` too) or URI (`spotify:playlist:<id>`),
 * a Spotify short link to follow (`spotify.link/<code>`), the first address
 * in text with words around it, or the bare YouTube playlist id. Anything
 * else is rejected with the reason to show.
 */
export const recognisePlaylistLink = (text: string): PlaylistLinkCheck => {
  const whole = text.trim();
  if (whole === "") return rejected("empty");
  const trimmed = /\s/u.test(whole) ? (addressIn(whole) ?? whole) : whole;
  const bare = BARE_ID.exec(trimmed)?.[1];
  if (bare !== undefined) return ytPlaylist(bare);
  const uri = SPOTIFY_URI.exec(trimmed);
  if (uri !== null) return spotifyEntity(uri[1] ?? "", uri[2] ?? "");
  const parts = LINK.exec(trimmed);
  if (parts === null) return rejected("notLink");
  const host = (parts[1] ?? "").toLowerCase();
  const path = parts[2] ?? "";
  if (host === SPOTIFY_HOST) return spotifyPath(path);
  if (SPOTIFY_SHORT_HOSTS.has(host)) {
    const code = SHORT_CODE.exec(path)?.[1];
    return code === undefined
      ? rejected("notPlaylist")
      : { ok: true, link: { service: "spotifyShort", url: `https://${host}/${code}` } };
  }
  if (host === SHORT_HOST) return rejected("song");
  if (!YOUTUBE_HOSTS.has(host)) return rejected("otherSite");
  if (path === "/watch") return rejected("song");
  const list = queryValue(parts[3] ?? "", "list");
  if (path !== "/playlist" || list === null || !ID.test(list)) return rejected("notPlaylist");
  return ytPlaylist(list);
};

/** A Spotify page's address in a page's source, up to its parameters. */
const SPOTIFY_PAGE = /https:\/\/open\.spotify\.com\/[^\s"'<>?#]+/u;

/**
 * The playlist a Spotify short link (`spotifyShort`) names once followed:
 * where following it landed ([url]) when that's Spotify's own page, otherwise
 * the first Spotify page in what it answered ([body]; Branch's page for apps
 * names it in its script). A short link to a song, or to nothing, is rejected
 * with the reason to show.
 */
export const spotifyShortLinkTarget = (url: string, body: string): PlaylistLinkCheck => {
  const landed = recognisePlaylistLink(url);
  if (landed.ok && landed.link.service === "spotify") return landed;
  const named = SPOTIFY_PAGE.exec(body)?.[0];
  if (named === undefined) return rejected("notPlaylist");
  const check = recognisePlaylistLink(named);
  return check.ok && check.link.service !== "spotify" ? rejected("notPlaylist") : check;
};

/** What sharing text to Wave does: open the import card for its playlist, or say why not. */
export type SharedTextImport =
  | { readonly kind: "import"; readonly link: PlaylistLink }
  | ({ readonly kind: "notice" } & ImportNotice);

/** A short message shown instead of the import card. */
export interface ImportNotice {
  readonly title: string;
  readonly message: string;
}

/** Why a link isn't read with YT Music off, wherever it came from. */
export const YT_MUSIC_OFF_NOTICE: ImportNotice = {
  title: "YT Music is off",
  message: "Turn on YT Music in Settings to import playlists from YouTube Music and Spotify links.",
};

const CANT_IMPORT_NOTICE: ImportNotice = {
  title: "Can't import this",
  message: REASONS.otherSite,
};

/**
 * What text shared to Wave from another app (Android's share sheet) opens:
 * the import card for the playlist named by the first web address or Spotify
 * URI in it (the bare link YouTube Music's app shares, Spotify's link or short
 * link, or a link among words, punctuation after it dropped), as
 * `recognisePlaylistLink` reads it. Anything else, a
 * bare playlist id included, gets a notice saying what Wave imports, and with
 * YT Music off everything gets one saying to turn it on.
 */
export const sharedTextImport = (
  text: string,
  { ytMusic }: { readonly ytMusic: boolean },
): SharedTextImport => {
  if (!ytMusic) return { kind: "notice", ...YT_MUSIC_OFF_NOTICE };
  const address = addressIn(text);
  const check = address === null ? null : recognisePlaylistLink(address);
  if (check?.ok === true) return { kind: "import", link: check.link };
  return { kind: "notice", ...CANT_IMPORT_NOTICE };
};

/** A playlist as read from its service: its name, cover and songs in its order. */
export interface LinkedPlaylist<S extends YtSong> {
  readonly title: string;
  readonly artworkUrl: string | null;
  readonly songs: readonly S[];
  /** It goes on past what was read (YouTube Music's 5,000-song cap). */
  readonly truncated: boolean;
}

/** A read playlist as the import card shows it, whichever service it came from. */
export interface ReadPlaylist {
  readonly title: string;
  readonly artworkUrl: string | null;
  /** Its songs as read. */
  readonly songs: readonly unknown[];
  /** It goes on past [songs]: the read stopped at a cap. */
  readonly truncated: boolean;
}

/** A song the import leaves out because it wasn't found, as the summary names it. */
export interface NotFoundSong {
  readonly title: string;
  /** Its artists as one credit. */
  readonly artist: string;
}

/** What importing a linked playlist makes. */
export interface LinkImportPlan<S extends YtSong> {
  /** The playlist's name, the source's title as a playlist name can be (before any clash). */
  readonly name: string;
  /** What the playlist holds, in the source's order: the Library's songs as its tracks, the rest streamed. */
  readonly songs: readonly PlaylistSong<S>[];
  /** How many of [songs] are the Library's. */
  readonly inLibrary: number;
  /** The source's songs found neither in the Library nor on YouTube Music (a Spotify import's), in its order. */
  readonly notFound: readonly NotFoundSong[];
}

/**
 * What importing [playlist] makes, given the Library: each song the Library
 * already has (Core's `libraryFinder`) as its track, the rest as YT Music
 * entries, in the playlist's order. A song that comes again goes in once, at
 * its first place, as a playlist takes songs (`planPlaylistSongs`).
 */
export const planLinkImport = <
  S extends YtSong,
  L extends LibrarySongKey & { readonly id: number },
>(
  playlist: LinkedPlaylist<S>,
  library: readonly L[],
): LinkImportPlan<S> => {
  const find = libraryFinder(library);
  const given = playlist.songs.map((song): PlaylistSong<S> => {
    const track = find(song);
    return track === null ? { source: "stream", song } : { source: "library", trackId: track.id };
  });
  const songs = planPlaylistSongs([], given).add;
  return {
    name: importedPlaylistName(playlist.title),
    songs,
    inLibrary: songs.filter((song) => song.source === "library").length,
    notFound: [],
  };
};

/** Where reading a linked playlist has got to. */
export type LinkImportRead<S extends YtSong> =
  | { readonly status: "reading" }
  /** Read, its songs being found in the Library and on YouTube Music (a Spotify import). */
  | {
      readonly status: "finding";
      readonly playlist: ReadPlaylist;
      /** How many of its songs are settled, found or not. */
      readonly done: number;
      readonly total: number;
    }
  | {
      readonly status: "read";
      readonly playlist: ReadPlaylist;
      readonly plan: LinkImportPlan<S>;
    }
  /**
   * Not read: no network, the service failed or doesn't know the playlist
   * (private, deleted, a wrong id), or YT Music was turned off meanwhile.
   */
  | { readonly status: "failed"; readonly reason: LinkReadFailure };

/**
 * Why a linked playlist wasn't read: YouTube Music's reasons (offline, failed,
 * turned off), Spotify's (no such public playlist, out of reach, an answer
 * that isn't the playlist), or a short link that led to a song or another page.
 */
export type LinkReadFailure =
  | YtQuietReason
  | "disabled"
  | "missing"
  | "unreachable"
  | "spotifyFailed"
  | "song"
  | "notPlaylist"
  /** YouTube Music kept refusing the searches that find a Spotify playlist's songs. */
  | "searchFailed";

const FAILURES: Record<LinkReadFailure, { readonly line: string; readonly retry: boolean }> = {
  offline: { line: "You're offline. Try again when you're back online.", retry: true },
  // YouTube Music answers a private or missing playlist as it answers a page it can't
  // serve, so the two share a message.
  failed: {
    line: "Couldn't read this playlist. It may be private or deleted, or YouTube Music didn't answer.",
    retry: true,
  },
  disabled: { line: "YT Music is off in Settings.", retry: false },
  missing: { line: "This playlist doesn't exist or isn't public.", retry: false },
  unreachable: {
    line: "Couldn't reach Spotify. Check your connection and try again.",
    retry: true,
  },
  spotifyFailed: {
    line: "Couldn't read this playlist. Spotify didn't answer as expected.",
    retry: true,
  },
  song: { line: REASONS.song, retry: false },
  notPlaylist: { line: REASONS.notPlaylist, retry: false },
  searchFailed: { line: "YouTube Music stopped answering while finding the songs.", retry: true },
};

/** What the import card shows. */
export interface LinkImportView {
  /** The playlist's name once read. */
  readonly name: string | null;
  readonly artworkUrl: string | null;
  /** Its songs and how many the Library has, or what stands in for them. */
  readonly line: string;
  /** A second, quieter line: how many songs weren't found, and that only part of the playlist was read. */
  readonly note: string | null;
  /** Whether Import is offered. */
  readonly canImport: boolean;
  /** Whether Try Again is offered. */
  readonly retry: boolean;
}

/** A card with a message in place of the playlist. */
const message = (line: string): LinkImportView => ({
  name: null,
  artworkUrl: null,
  line,
  note: null,
  canImport: false,
  retry: false,
});

/** "1 song wasn't found." / "3 songs weren't found." */
const notFoundLine = (count: number): string =>
  `${counted(count, "song")} ${count === 1 ? "wasn't" : "weren't"} found`;

/** The import card for a linked playlist being read, its songs found, read, or not read. */
export const linkImportView = <S extends YtSong>(read: LinkImportRead<S>): LinkImportView => {
  if (read.status === "reading") return message("Reading the playlist…");
  if (read.status === "failed") {
    const { line, retry } = FAILURES[read.reason];
    return { ...message(line), retry };
  }
  if (read.status === "finding") {
    return {
      ...message(
        `Finding songs… ${read.done.toLocaleString("en")} of ${read.total.toLocaleString("en")}`,
      ),
      name: importedPlaylistName(read.playlist.title),
      artworkUrl: read.playlist.artworkUrl,
    };
  }
  const { playlist, plan } = read;
  const head = { name: plan.name, artworkUrl: playlist.artworkUrl };
  const total = plan.songs.length;
  if (total === 0) {
    const none =
      plan.notFound.length > 0 ? "None of its songs were found." : "It has no songs to import.";
    return { ...message(none), ...head };
  }
  const had =
    plan.inLibrary === 0
      ? "none"
      : plan.inLibrary === total
        ? "all"
        : plan.inLibrary.toLocaleString("en");
  const notes = [
    plan.notFound.length > 0 ? `${notFoundLine(plan.notFound.length)}.` : null,
    playlist.truncated
      ? `It goes on past ${counted(playlist.songs.length, "song")}. Only those are imported.`
      : null,
  ].filter((note) => note !== null);
  return {
    ...head,
    line: `${counted(total, "song")} · ${had} in your Library`,
    note: notes.length === 0 ? null : notes.join(" "),
    canImport: true,
    retry: false,
  };
};

/**
 * What's said once a playlist is imported without some of its songs: how
 * many weren't found, and each by title and artist, in the source's order.
 * Null when every song was found.
 */
export const linkImportSummary = <S extends YtSong>(
  plan: LinkImportPlan<S>,
): ImportNotice | null => {
  if (plan.notFound.length === 0) return null;
  const songs = plan.notFound.map((song) => `${song.title} · ${song.artist}`).join("\n");
  return {
    title: notFoundLine(plan.notFound.length),
    message: `${plan.name} was imported without them:\n\n${songs}`,
  };
};
