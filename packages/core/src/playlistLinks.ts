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
export interface PlaylistLink {
  readonly service: "ytMusic";
  /** YouTube's playlist id, without `VL`: all that is sent. */
  readonly playlistId: string;
}

/** Why a link names no playlist Wave can read. */
export type PlaylistLinkProblem = "empty" | "notLink" | "otherSite" | "song" | "notPlaylist";

export type PlaylistLinkCheck =
  | { readonly ok: true; readonly link: PlaylistLink }
  | { readonly ok: false; readonly problem: PlaylistLinkProblem; readonly reason: string };

const ASK = "Paste a link to a YouTube Music playlist.";

const REASONS: Record<PlaylistLinkProblem, string> = {
  empty: ASK,
  notLink: ASK,
  otherSite: "Wave imports playlists from YouTube Music links.",
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

/** A web address among words, as an app shares a link with its title. */
const ADDRESS = /\bhttps?:\/\/\S+/iu;

/**
 * The playlist a pasted or shared link names: a YouTube Music or YouTube
 * playlist link (any of YouTube's hosts, extra parameters ignored), the
 * first address in text with words around it, or the bare playlist id.
 * Anything else is rejected with the reason to show.
 */
export const recognisePlaylistLink = (text: string): PlaylistLinkCheck => {
  const whole = text.trim();
  if (whole === "") return rejected("empty");
  const trimmed = /\s/u.test(whole) ? (ADDRESS.exec(whole)?.[0] ?? whole) : whole;
  const bare = BARE_ID.exec(trimmed)?.[1];
  if (bare !== undefined) return ytPlaylist(bare);
  const parts = LINK.exec(trimmed);
  if (parts === null) return rejected("notLink");
  const host = (parts[1] ?? "").toLowerCase();
  const path = parts[2] ?? "";
  if (host === SHORT_HOST) return rejected("song");
  if (!YOUTUBE_HOSTS.has(host)) return rejected("otherSite");
  if (path === "/watch") return rejected("song");
  const list = queryValue(parts[3] ?? "", "list");
  if (path !== "/playlist" || list === null || !ID.test(list)) return rejected("notPlaylist");
  return ytPlaylist(list);
};

/** A playlist as read from its service: its name, cover and songs in its order. */
export interface LinkedPlaylist<S extends YtSong> {
  readonly title: string;
  readonly artworkUrl: string | null;
  readonly songs: readonly S[];
  /** It goes on past what was read (YouTube Music's 5,000-song cap). */
  readonly truncated: boolean;
}

/** What importing a linked playlist makes. */
export interface LinkImportPlan<S extends YtSong> {
  /** The playlist's name, the source's title as a playlist name can be (before any clash). */
  readonly name: string;
  /** What the playlist holds, in the source's order: the Library's songs as its tracks, the rest streamed. */
  readonly songs: readonly PlaylistSong<S>[];
  /** How many of [songs] are the Library's. */
  readonly inLibrary: number;
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
  };
};

/** Where reading a linked playlist has got to. */
export type LinkImportRead<S extends YtSong> =
  | { readonly status: "reading" }
  | {
      readonly status: "read";
      readonly playlist: LinkedPlaylist<S>;
      readonly plan: LinkImportPlan<S>;
    }
  /**
   * Not read: no network, the service failed or doesn't know the playlist
   * (private, deleted, a wrong id), or YT Music was turned off meanwhile.
   */
  | { readonly status: "failed"; readonly reason: LinkReadFailure };

export type LinkReadFailure = YtQuietReason | "disabled";

const FAILURES: Record<LinkReadFailure, { readonly line: string; readonly retry: boolean }> = {
  offline: { line: "You're offline. Try again when you're back online.", retry: true },
  // YouTube Music answers a private or missing playlist as it answers a page it can't
  // serve, so the two share a message.
  failed: {
    line: "Couldn't read this playlist. It may be private or deleted, or YouTube Music didn't answer.",
    retry: true,
  },
  disabled: { line: "YT Music is off in Settings.", retry: false },
};

/** What the import card shows. */
export interface LinkImportView {
  /** The playlist's name once read. */
  readonly name: string | null;
  readonly artworkUrl: string | null;
  /** Its songs and how many the Library has, or what stands in for them. */
  readonly line: string;
  /** A second, quieter line: that only part of the playlist was read. */
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

/** The import card for a linked playlist being read, read, or not read. */
export const linkImportView = <S extends YtSong>(read: LinkImportRead<S>): LinkImportView => {
  if (read.status === "reading") return message("Reading the playlist…");
  if (read.status === "failed") {
    const { line, retry } = FAILURES[read.reason];
    return { ...message(line), retry };
  }
  const { playlist, plan } = read;
  const head = { name: plan.name, artworkUrl: playlist.artworkUrl };
  const total = plan.songs.length;
  if (total === 0) return { ...message("It has no songs to import."), ...head };
  const had =
    plan.inLibrary === 0
      ? "none"
      : plan.inLibrary === total
        ? "all"
        : plan.inLibrary.toLocaleString("en");
  return {
    ...head,
    line: `${counted(total, "song")} · ${had} in your Library`,
    note: playlist.truncated
      ? `It goes on past ${counted(playlist.songs.length, "song")}. Only those are imported.`
      : null,
    canImport: true,
    retry: false,
  };
};
