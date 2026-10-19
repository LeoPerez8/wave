/**
 * A song's links for its share sheet (docs/spec.md, "Sharing a song"): YT
 * Music's and song.link's pages come from the song's YouTube video id (its
 * own, else one YouTube Music search), Spotify's from Wave's own Spotify
 * search as the signed-in account. Each destination stands on its own.
 */

import { ytShareMatch } from "./playlistShare.ts";
import type { SongLinkOption } from "./songShare.ts";
import { spotifySearchQuery } from "./spotifyImport.ts";
import type { SpotifyAccountAnswer, SpotifyAccountFailure } from "./spotifyLibrary.ts";
import type { SpotifySong } from "./spotifyPlaylist.ts";
import { spotifyShareMatch, spotifyShareSong } from "./spotifyShare.ts";
import type { YtSong } from "./ytMusic.ts";

/** Why a lookup has no link: nothing is the song, no answer (offline), or a failure. */
type NoLink =
  { readonly status: "notFound" } | { readonly status: "offline" } | { readonly status: "failed" };

/** Where the song's YouTube video id stands: loading, found, or why there's none. */
export type SongVideoState =
  { readonly status: "loading" } | { readonly status: "found"; readonly videoId: string } | NoLink;

/** Where the song's Spotify track stands: loading, its link, or why there's none. */
export type SpotifyTrackState =
  | { readonly status: "loading" }
  | { readonly status: "found"; readonly url: string }
  | { readonly status: "signedOut" }
  | NoLink;

/** Where a song's links stand: its video id (Copy Link, YT Music) and its Spotify track. */
export interface SongLinksState {
  readonly video: SongVideoState;
  readonly spotify: SpotifyTrackState;
}

/** A song's links before any lookup has answered. */
export const SONG_LINKS_LOADING: SongLinksState = {
  video: { status: "loading" },
  spotify: { status: "loading" },
};

/** A song whose links are looked up: its video id, else what is searched for. */
export interface SongLinkLookup {
  readonly videoId: string | null;
  readonly search: SpotifySong | null;
}

/** One YouTube Music Songs search for [song], as sharing searches (`ytShareMatch`). */
export type SongLinkSearch = (
  song: SpotifySong,
) => Promise<
  | { readonly ok: true; readonly songs: readonly YtSong[] }
  | { readonly ok: false; readonly reason: "offline" | "failed" | "disabled" }
>;

/**
 * [song]'s YouTube video id: its own, else the first result of one YouTube
 * Music search ([search]) by its title and artists that is the same
 * recording (`ytShareMatch`).
 */
export const lookUpSongVideo = async (
  song: SongLinkLookup,
  search: SongLinkSearch,
): Promise<SongVideoState> => {
  if (song.videoId !== null) return { status: "found", videoId: song.videoId };
  if (song.search === null) return { status: "notFound" };
  const answer = await search(song.search);
  if (!answer.ok) return { status: answer.reason === "offline" ? "offline" : "failed" };
  const videoId = ytShareMatch(song.search, answer.songs);
  return videoId === null ? { status: "notFound" } : { status: "found", videoId };
};

/** The signed-in Spotify account, as the share sheet asks it. */
export interface SongLinkSpotify {
  /** Whether Wave holds a Spotify session (as saved; Spotify isn't asked). */
  readonly signedIn: () => Promise<boolean>;
  /** One `searchTracks` for [term] as the account: its `data`, or why there wasn't one. */
  readonly search: (term: string) => Promise<SpotifyAccountAnswer>;
}

/** How a Spotify search with no answer leaves the link: a session Spotify refused is signed out. */
const SPOTIFY_FAILURES = {
  offline: "offline",
  signedOut: "signedOut",
  failed: "failed",
  changed: "failed",
} as const satisfies Record<SpotifyAccountFailure, SpotifyTrackState["status"]>;

/** `open.spotify.com`'s page of the track [uri] (`spotify:track:<id>`). */
const spotifyTrackUrl = (uri: string): string =>
  `https://open.spotify.com/track/${uri.split(":").at(-1) ?? ""}`;

/**
 * [song]'s track on Spotify: one search with Spotify's own search as the
 * signed-in account ([spotify]) for its title and artists, taking the first
 * result that is the same recording and that Spotify plays, as sharing a
 * playlist does (`spotifyShareSong`, `spotifyShareMatch`). Nothing is sent
 * signed out.
 */
export const lookUpSpotifyTrack = async (
  song: SpotifySong | null,
  spotify: SongLinkSpotify,
): Promise<SpotifyTrackState> => {
  if (!(await spotify.signedIn())) return { status: "signedOut" };
  const search = song === null ? undefined : spotifyShareSong({ source: "library", song }).search;
  if (search === undefined) return { status: "notFound" };
  const answer = await spotify.search(spotifySearchQuery(search));
  if (!answer.ok) return { status: SPOTIFY_FAILURES[answer.reason] };
  const uri = spotifyShareMatch(search, answer.data);
  if (uri === undefined) return { status: "failed" };
  return uri === null ? { status: "notFound" } : { status: "found", url: spotifyTrackUrl(uri) };
};

/** How a link option shows: the link it shares (null: disabled), loading, or why it has none. */
export interface SongLinkView {
  readonly url: string | null;
  readonly loading: boolean;
  readonly note: "Offline" | "Unavailable" | "No Match" | "Signed Out" | null;
}

const NOTES = {
  offline: "Offline",
  failed: "Unavailable",
  notFound: "No Match",
  signedOut: "Signed Out",
} as const satisfies Record<string, SongLinkView["note"]>;

/** The song.link page (any platform) and the YT Music page of the video [videoId]. */
const VIDEO_URLS = {
  copyLink: (videoId: string) => `https://song.link/y/${videoId}`,
  ytMusic: (videoId: string) => `https://music.youtube.com/watch?v=${videoId}`,
} as const;

/**
 * Where one link option's lookup stands: loading, its link, or a reason with
 * a note. A lookup state with a status that has no note isn't one, so it
 * fails to compile until `NOTES` has it.
 */
type LinkState =
  | { readonly status: "loading" }
  | { readonly status: "found"; readonly url: string }
  | { readonly status: keyof typeof NOTES };

/** How a link option whose lookup is [state] shows. */
const viewOf = (state: LinkState): SongLinkView => {
  if (state.status === "loading") return { url: null, loading: true, note: null };
  if (state.status === "found") return { url: state.url, loading: false, note: null };
  return { url: null, loading: false, note: NOTES[state.status] };
};

/**
 * How the link [option] shows in the share sheet while the song's links are
 * [state]: Copy Link shares the song.link page of the song's video, YT Music
 * the video's own page, Spotify the matching track; one with no link is
 * disabled and says why. Each goes by its own lookup only.
 */
export const songLinkView = (option: SongLinkOption, state: SongLinksState): SongLinkView =>
  viewOf(
    option === "spotify"
      ? state.spotify
      : state.video.status === "found"
        ? { status: "found", url: VIDEO_URLS[option](state.video.videoId) }
        : state.video,
  );
