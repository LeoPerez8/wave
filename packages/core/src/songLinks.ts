/**
 * A song's links for its share sheet (docs/spec.md, "Sharing a song"): Odesli
 * (song.link's free, keyless API) is asked by the song's YouTube video id for
 * its universal song.link page and its Spotify and YT Music links.
 */

import { at, text } from "./json.ts";
import { ytShareMatch } from "./playlistShare.ts";
import type { SongLinkOption } from "./songShare.ts";
import type { SpotifySong } from "./spotifyPlaylist.ts";
import type { YtSong } from "./ytMusic.ts";

/** A song's links: song.link's page (any platform), and the song on Spotify and YT Music. */
export interface SongLinks {
  readonly page: string;
  readonly spotify: string | null;
  readonly ytMusic: string;
}

/** Where a song's links stand: loading, found, or why there are none. */
export type SongLinksState =
  | { readonly status: "loading" }
  | { readonly status: "found"; readonly links: SongLinks }
  | { readonly status: "notFound" }
  | { readonly status: "offline" }
  | { readonly status: "failed" };

/** A song whose links are looked up: its video id, else what YT Music is searched for. */
export interface SongLinkLookup {
  readonly videoId: string | null;
  readonly search: SpotifySong | null;
}

/** One GET of [url]: its status and body. Rejects when it can't be sent (offline). */
export type SongLinkAsk = (
  url: string,
) => Promise<{ readonly status: number; readonly body: string }>;

/** One YouTube Music Songs search for [song], as sharing searches (`ytShareMatch`). */
export type SongLinkSearch = (
  song: SpotifySong,
) => Promise<
  | { readonly ok: true; readonly songs: readonly YtSong[] }
  | { readonly ok: false; readonly reason: "offline" | "failed" | "disabled" }
>;

const ODESLI = "https://api.song.link/v1-alpha.1/links";

const ytMusicSongUrl = (videoId: string): string => `https://music.youtube.com/watch?v=${videoId}`;

/** Odesli's lookup for the song YouTube has as [videoId]. */
const odesliUrl = (videoId: string): string =>
  `${ODESLI}?url=${encodeURIComponent(ytMusicSongUrl(videoId))}`;

/** The url Odesli's answer gives for [platform], or null. */
const platformUrl = (links: unknown, platform: string): string | null =>
  text(at(links, platform, "url"));

/**
 * The links in Odesli's answer [body] about [videoId], or null when it has no
 * song.link page. YT Music always has the video it was asked about.
 */
const odesliLinks = (body: string, videoId: string): SongLinks | null => {
  let answer: unknown;
  try {
    answer = JSON.parse(body);
  } catch {
    return null;
  }
  const page = text(at(answer, "pageUrl"));
  if (page === null) return null;
  const links = at(answer, "linksByPlatform");
  return {
    page,
    spotify: platformUrl(links, "spotify"),
    ytMusic: platformUrl(links, "youtubeMusic") ?? ytMusicSongUrl(videoId),
  };
};

/** [song]'s video id: its own, else the first result of one search that is the same recording. */
const findVideoId = async (
  song: SongLinkLookup,
  search: SongLinkSearch,
): Promise<string | Exclude<SongLinksState, { status: "found" | "loading" }>> => {
  if (song.videoId !== null) return song.videoId;
  if (song.search === null) return { status: "notFound" };
  const answer = await search(song.search);
  if (!answer.ok) return { status: answer.reason === "offline" ? "offline" : "failed" };
  return ytShareMatch(song.search, answer.songs) ?? { status: "notFound" };
};

/**
 * Looks up [song]'s links: Odesli is asked by its video id; a song without
 * one (a Library song not downloaded from YouTube) is first searched once on
 * YouTube Music by its title and artists ([search]), taking the result that
 * is the same recording (`ytShareMatch`). Odesli gets nothing but the video id.
 */
export const lookUpSongLinks = async (
  song: SongLinkLookup,
  search: SongLinkSearch,
  ask: SongLinkAsk,
): Promise<SongLinksState> => {
  const videoId = await findVideoId(song, search);
  if (typeof videoId !== "string") return videoId;
  let response: Awaited<ReturnType<SongLinkAsk>>;
  try {
    response = await ask(odesliUrl(videoId));
  } catch {
    return { status: "offline" };
  }
  // Odesli answers a song it can't resolve with 400 or 404; a refusal (429, about 10 a minute) fails.
  if (response.status === 400 || response.status === 404) return { status: "notFound" };
  if (response.status !== 200) return { status: "failed" };
  const links = odesliLinks(response.body, videoId);
  return links === null ? { status: "failed" } : { status: "found", links };
};

/** How a link option shows: the link it shares (null: disabled), loading, or why it has none. */
export interface SongLinkView {
  readonly url: string | null;
  readonly loading: boolean;
  readonly note: "Offline" | "Unavailable" | "No Match" | null;
}

const NOTES = {
  offline: "Offline",
  failed: "Unavailable",
  notFound: "No Match",
} as const satisfies Record<string, SongLinkView["note"]>;

/**
 * How the link [option] shows in the share sheet while the song's links are
 * [state]: Copy Link shares song.link's page, Spotify and YT Music their
 * platform's link, and one with no link is disabled and says why.
 */
export const songLinkView = (option: SongLinkOption, state: SongLinksState): SongLinkView => {
  switch (state.status) {
    case "loading":
      return { url: null, loading: true, note: null };
    case "found": {
      const { page, spotify, ytMusic } = state.links;
      const url = { copyLink: page, spotify, ytMusic }[option];
      return { url, loading: false, note: url === null ? NOTES.notFound : null };
    }
    default:
      return { url: null, loading: false, note: NOTES[state.status] };
  }
};
