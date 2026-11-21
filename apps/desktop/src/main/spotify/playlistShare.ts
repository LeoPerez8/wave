/**
 * Share to Spotify (docs/spec.md, "Sharing playlists"), as the desktop does it: through
 * Spotify's official Web API, signed in as #1201's account. Core decides which songs go in
 * (`matchSharedSongs`, `spotifyWebShareMatch`); this sends the requests and copies the link.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import { selectPlaylist } from "@wave/client/db/playlists";
import {
  librarySearchSong,
  matchSharedSongs,
  sharedEditBatches,
  spotifyPlaylistUrl,
  spotifySearchQuery,
  spotifyShareSong,
  spotifyWebShareMatch,
  type SharePlaylistFailure,
  type SpotifyShareItem,
  type SpotifySong,
} from "@wave/core";
import type { SpotifyShareOutcome } from "../../shared/spotifyShare.ts";
import { preference, savePreference } from "../preferences.ts";
import type { SpotifyAccountService, SpotifyRequestInit } from "./spotifyAccount.ts";

type Request = SpotifyAccountService["request"];

/** Why a request to Spotify ended the work. */
class Stop extends Error {
  readonly reason: SharePlaylistFailure;
  constructor(reason: SharePlaylistFailure) {
    super(reason);
    this.reason = reason;
  }
}

const RATE_LIMIT_RETRIES = 3;
const LONGEST_WAIT_MS = 30_000;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How long Spotify asks to wait after a 429, in milliseconds. */
const retryAfter = (response: Response): number => {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1_000, LONGEST_WAIT_MS)
    : 1_000;
};

/** Spotify's HTTP answer to one request, waiting out a rate limit; stops without one. */
const send = async (
  request: Request,
  sleep: (ms: number) => Promise<void>,
  path: string,
  init?: SpotifyRequestInit,
): Promise<Response> => {
  for (let attempt = 0; ; attempt += 1) {
    const result = await request(path, init);
    if (result.status === "offline") throw new Stop("offline");
    if (result.status === "signedOut" || result.status === "expired") throw new Stop("signedOut");
    if (result.status !== "response") throw new Stop("failed");
    const { response } = result;
    if (response.status !== 429 || attempt === RATE_LIMIT_RETRIES) return response;
    void response.body?.cancel().catch(() => {});
    await sleep(retryAfter(response));
  }
};

const json = (body: unknown): SpotifyRequestInit => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** What a search for one recording on Spotify found, or why it couldn't be asked. */
export type SpotifyRecordingSearch =
  | { readonly ok: true; readonly uri: string | null }
  | { readonly ok: false; readonly reason: SharePlaylistFailure };

const searchRecording = async (
  request: Request,
  sleep: (ms: number) => Promise<void>,
  song: SpotifySong,
): Promise<string | null> => {
  const query = new URLSearchParams({ q: spotifySearchQuery(song), type: "track", limit: "10" });
  const response = await send(request, sleep, `/v1/search?${query}`);
  if (!response.ok) throw new Stop("noSearchAnswer");
  const uri = spotifyWebShareMatch(song, await response.json().catch(() => null));
  if (uri === undefined) throw new Stop("noSearchAnswer");
  return uri;
};

/**
 * The Spotify track URI (`spotify:track:<id>`) of the same recording as [song], by Core's
 * rules, from one search as the signed-in account: null when Spotify has none.
 */
export const findSpotifyRecording = async (
  request: Request,
  song: SpotifySong,
  sleep: (ms: number) => Promise<void> = pause,
): Promise<SpotifyRecordingSearch> => {
  try {
    return { ok: true, uri: await searchRecording(request, sleep, song) };
  } catch (error) {
    return { ok: false, reason: error instanceof Stop ? error.reason : "failed" };
  }
};

export interface SpotifyPlaylistShare {
  /** The Wave playlist's name, which the Spotify one takes. */
  readonly name: string;
  readonly items: readonly SpotifyShareItem[];
  readonly session: () => "signedOut" | "signedIn" | "expired";
  readonly request: Request;
  /** The id of the Spotify playlist sharing made for this Wave playlist before. */
  readonly recall: () => string | undefined;
  readonly remember: (playlistId: string) => void;
  readonly writeClipboard: (text: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

const PLAYLIST_ID = /^[A-Za-z0-9]{1,64}$/u;

/**
 * Makes the Wave playlist's public copy on the Spotify account, or brings the one made before
 * up to date under the same link, and copies that link.
 */
export const shareSpotifyPlaylist = async (
  options: SpotifyPlaylistShare,
): Promise<SpotifyShareOutcome> => {
  const { name, request, sleep = pause } = options;
  const status = options.session();
  if (status !== "signedIn") return { kind: "signIn", again: status === "expired" };
  const ask = (path: string, init?: SpotifyRequestInit) => send(request, sleep, path, init);
  /** A write Spotify must take. */
  const write = async (path: string, init: SpotifyRequestInit) => {
    const response = await ask(path, init);
    if (!response.ok) throw new Stop("failed");
    return response;
  };

  /** Whether the playlist made before took the name and is still this account's to fill. */
  const kept = async (id: string): Promise<boolean> => {
    // A playlist deleted on Spotify leaves the account's library but still takes edits.
    const held = await ask(
      `/v1/me/library/contains?uris=${encodeURIComponent(`spotify:playlist:${id}`)}`,
    );
    if (held.ok) {
      const answer: unknown = await held.json().catch(() => null);
      if (Array.isArray(answer) && answer[0] === false) return false;
    }
    const renamed = await ask(`/v1/playlists/${id}`, {
      method: "PUT",
      ...json({ name, public: true }),
    });
    // Another account's, or one Spotify no longer has.
    if (renamed.status === 403 || renamed.status === 404) return false;
    if (!renamed.ok) throw new Stop("failed");
    return true;
  };

  const create = async (): Promise<string> => {
    const made = await write("/v1/me/playlists", {
      method: "POST",
      ...json({ name, public: true }),
    });
    const id = ((await made.json().catch(() => null)) as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !PLAYLIST_ID.test(id)) throw new Stop("failed");
    options.remember(id);
    return id;
  };

  try {
    const shared = await matchSharedSongs(options.items.map(spotifyShareSong), (song) =>
      searchRecording(request, sleep, song),
    );
    if (shared.ids.length === 0) return { kind: "nothingFound" };

    const remembered = options.recall();
    const id =
      remembered !== undefined && PLAYLIST_ID.test(remembered) && (await kept(remembered))
        ? remembered
        : await create();
    // The first request replaces what the playlist held; the rest add to its end, in order.
    for (const [index, uris] of sharedEditBatches(shared.ids).entries())
      await write(`/v1/playlists/${id}/items`, {
        method: index === 0 ? "PUT" : "POST",
        ...json({ uris }),
      });
    options.writeClipboard(spotifyPlaylistUrl(id));
    return { kind: "shared", found: shared.found, total: shared.total };
  } catch (error) {
    return { kind: "failed", reason: error instanceof Stop ? error.reason : "failed" };
  }
};

/**
 * Share to Spotify for the Library playlist [playlistId]. The Spotify playlist made for it is
 * remembered on this computer, so sharing again updates that one.
 */
export const shareLibraryPlaylist = (
  ports: {
    readonly db: LibraryDatabase;
    readonly account: Pick<SpotifyAccountService, "session" | "request">;
    readonly writeClipboard: (text: string) => void;
  },
  playlistId: number,
): Promise<SpotifyShareOutcome> => {
  const detail = selectPlaylist(ports.db, playlistId);
  if (detail === null) throw new Error("Playlist no longer exists");
  const key = `share.spotify.${playlistId}`;
  return shareSpotifyPlaylist({
    name: detail.playlist.name,
    items: detail.items.map((item) =>
      item.source === "library" ? { source: "library", song: librarySearchSong(item.track) } : item,
    ),
    session: () => ports.account.session().status,
    request: ports.account.request,
    recall: () => preference(ports.db, key),
    remember: (id) => savePreference(ports.db, key, id),
    writeClipboard: ports.writeClipboard,
  });
};
