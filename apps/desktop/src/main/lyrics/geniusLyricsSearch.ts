import { askWaveService } from "@wave/client/askWaveService";
import { resolveGeniusHit } from "@wave/client/geniusHitMenu";
import { requestGeniusLyricsSearch } from "@wave/client/geniusLyricsSearch";
import { GENIUS_REQUEST_TIMEOUT_MS } from "@wave/client/geniusSource";
import type { GeniusLyricsHit, RecognizeTrack, YtAlbumSong } from "@wave/core";

import type { GeniusHitOpened, GeniusLyricsSearchView } from "../../shared/geniusLyricsSearch.ts";

export interface GeniusLyricsSearchDeps<L extends RecognizeTrack> {
  /** "Genius insights" is on. */
  readonly enabled: () => boolean;
  /** `unavailable` when this build has no Wave account. */
  readonly account: () => "signedIn" | "signedOut" | "unavailable";
  readonly online: () => boolean;
  /** A GET to the sync service with the Wave session. */
  readonly request: (
    method: "GET",
    path: string,
    body: null,
    signal: AbortSignal,
  ) => Promise<{ readonly status: number; readonly body: string }>;
  /** The Library's songs, as read now. */
  readonly library: () => readonly L[];
  readonly ytMusic: () => boolean;
  /** YT Music's Songs for [query]; rejects when it can't be asked. */
  readonly searchSongs: (query: string) => Promise<readonly YtAlbumSong[]>;
  readonly start: (song: L | YtAlbumSong) => Promise<void>;
  /** Opens [url] in the system browser. */
  readonly openUrl: (url: string) => Promise<void>;
}

export interface DesktopGeniusLyricsSearch {
  /** Genius's songs for [query], or why none were asked for. A newer search ends an older one. */
  readonly search: (query: string) => Promise<GeniusLyricsSearchView>;
  /**
   * A click on hit [id] of the last answer: the Library's song plays, else YT Music's when it is
   * on and has it, else the hit's Genius page opens. A click while one resolves joins it.
   */
  readonly open: (id: number) => Promise<GeniusHitOpened>;
  /** Stops the request under way, if any. */
  readonly cancel: () => void;
}

/** Only a page of Genius's own site goes to the system browser. */
const geniusPage = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.port === "" &&
      (parsed.hostname === "genius.com" || parsed.hostname.endsWith(".genius.com"))
    );
  } catch {
    return false;
  }
};

/**
 * Search's online lyrics on the desktop (docs/spec.md, "Lyrics search"): main asks Genius
 * through the sync service with the Wave session, with the phone's rules
 * (`requestGeniusLyricsSearch`).
 */
export const createGeniusLyricsSearch = <L extends RecognizeTrack>(
  deps: GeniusLyricsSearchDeps<L>,
): DesktopGeniusLyricsSearch => {
  let pending: AbortController | undefined;
  let hits: readonly GeniusLyricsHit[] = [];
  let opening: Promise<GeniusHitOpened> | undefined;
  const open = async (hit: GeniusLyricsHit): Promise<GeniusHitOpened> => {
    const result = await resolveGeniusHit<L, YtAlbumSong>(
      {
        library: async () => deps.library(),
        ytMusic: deps.ytMusic,
        search: async (_asker, query) => {
          if (!deps.online()) return { ok: false, reason: "offline" };
          try {
            return { ok: true, songs: await deps.searchSongs(query) };
          } catch {
            return { ok: false, reason: "failed" };
          }
        },
      },
      hit,
      new AbortController().signal,
    );
    if (result.kind === "library" || result.kind === "stream") {
      await deps.start(result.kind === "library" ? result.track : result.song);
      return "played";
    }
    if (!geniusPage(hit.url)) return "failed";
    await deps.openUrl(hit.url);
    return "opened";
  };
  const cancel = () => {
    pending?.abort();
    pending = undefined;
  };
  return {
    cancel,
    open: (id) => {
      const hit = hits.find((candidate) => candidate.id === id);
      if (hit === undefined) return Promise.resolve("failed");
      opening ??= open(hit)
        .catch((cause: unknown): GeniusHitOpened => {
          console.warn("[wave] couldn't open a Genius result", cause);
          return "failed";
        })
        .finally(() => {
          opening = undefined;
        });
      return opening;
    },
    search: async (query) => {
      cancel();
      const account = deps.account();
      const controller = new AbortController();
      pending = controller;
      try {
        const state = await requestGeniusLyricsSearch(query, {
          enabled: deps.enabled() && account !== "unavailable",
          signedIn: account === "signedIn",
          isOnline: deps.online,
          ask: (path) =>
            askWaveService(
              (method, route, body) =>
                deps.request(
                  method,
                  route,
                  body,
                  AbortSignal.any([
                    controller.signal,
                    AbortSignal.timeout(GENIUS_REQUEST_TIMEOUT_MS),
                  ]),
                ),
              path,
            ),
        });
        // An ended request (a newer search, the switch turned off) shows nothing of its own.
        if (!deps.enabled()) return { status: "disabled" };
        if (controller.signal.aborted) return { status: "idle" };
        if (state.status === "hits") {
          hits = state.hits;
          return { status: "hits", hits };
        }
        return { status: state.status === "loading" ? "idle" : state.status };
      } finally {
        if (pending === controller) pending = undefined;
      }
    },
  };
};
