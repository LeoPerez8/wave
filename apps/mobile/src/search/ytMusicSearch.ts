import {
  YT_SECTION_HIDDEN,
  stepYtSection,
  ytSearchAsksVideos,
  type YtCommunityPlaylist,
  type YtPick,
  type YtSection,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useLayoutEffect, useReducer, useSyncExternalStore } from "react";

import { online, subscribeConnectivity } from "@/native/waveNative";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { useSearchOnlineAlways } from "@/settings/searchOnline";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import type { YtMusicError } from "@/ytmusic/YtMusic";

import { keepYtSearch, keptYtSearch } from "./knownYtSearches";

/**
 * [search] for [query]: asked as you type ([always], Search online set to
 * Always), it waits its turn in the shared search allowance; otherwise at once.
 */
const inTurn = <A, R>(
  always: boolean,
  query: string,
  search: Effect.Effect<A, YtMusicError, R>,
): Effect.Effect<A, YtMusicError, R> => (always ? withSearchTurn("search", query, search) : search);

/** What `useYtMusicSection` steps its section with (Core's `stepYtSection`). */
type YtSectionStep = Parameters<typeof stepYtSection<NativeYtSong>>[1];

/**
 * YT Music's songs (unless [songless]), artists and albums for [query], and
 * its matching official music videos when no song matches (Core's
 * `ytSearchAsksVideos`), handed to [step] as soon as they are in; then the
 * Community playlists shelf (none when [songless]), which the answer carries.
 * Kept out of the hook, so the React Compiler builds the hook.
 */
const searchAll = (
  query: string,
  always: boolean,
  songless: boolean,
  step: (event: YtSectionStep) => void,
) =>
  // Only the query is sent. A failed Songs, Artists or Albums search fails the three: one quiet line.
  askYtMusic((ytMusic) =>
    Effect.all(
      {
        found: Effect.gen(function* () {
          const found = yield* Effect.all(
            {
              songs: songless
                ? Effect.succeed({ songs: [] as NativeYtSong[] })
                : inTurn(always, query, ytMusic.searchSongs(query)),
              artists: inTurn(always, query, ytMusic.searchArtists(query)),
              albums: inTurn(always, query, ytMusic.searchAlbums(query)),
            },
            { concurrency: "unbounded" },
          );
          const videos =
            !songless && ytSearchAsksVideos(query, found.songs.songs)
              ? yield* inTurn(always, query, ytMusic.searchVideos(query)).pipe(
                  Effect.map((page) => page.songs),
                  Effect.orElseSucceed(() => []),
                )
              : undefined;
          // Shown as soon as they are in, without waiting for the shelf.
          step({
            type: "found",
            query,
            songs: found.songs.songs,
            artists: found.artists,
            albums: found.albums,
            videos,
          });
        }),
        // The shelf is an extra, asked alongside: a failed read shows none and leaves the rest.
        playlists: songless
          ? Effect.succeed([] as readonly YtCommunityPlaylist[])
          : inTurn(always, query, ytMusic.searchCommunityPlaylists(query)).pipe(
              Effect.orElseSucceed((): readonly YtCommunityPlaylist[] => []),
            ),
      },
      { concurrency: "unbounded" },
    ),
  );

/** Add Songs has no category picker: after the shared section settles, ask only Songs. */
const searchSongsOnly = (query: string, step: (event: YtSectionStep) => void) =>
  askYtMusic((ytMusic) =>
    inTurn(true, query, ytMusic.searchSongs(query)).pipe(
      Effect.map((found) => {
        step({
          type: "found",
          query,
          songs: found.songs,
          artists: [],
          albums: [],
          videos: undefined,
        });
        return { playlists: [] as readonly YtCommunityPlaylist[] };
      }),
    ),
  );

/**
 * What a search embedded in another flow asks YT Music for, in place of the
 * Search tab's. It asks only while the phone is online (offline, the
 * Library's results stand alone), and asks again for what's typed once the
 * phone is back online.
 */
export interface YtSearchScope {
  /**
   * Artists and albums alone, every query asked once typing pauses whatever
   * Search online says (the flow has no Library | Online toggle).
   */
  readonly artistsAndAlbums: true;
}

/**
 * What Search has asked YT Music for [query] (its songs, artists, albums and
 * community playlists, asked together; the first three show as soon as they
 * are in, and the Community playlists shelf joins them when it arrives), and
 * what picking a segment of the Library | Online toggle does. Typing alone asks only when the Library has nothing for the query
 * ([libraryHasResults] false) and Library wasn't picked, once typing pauses;
 * Online asks at once (or shows again what it already has for the query),
 * and the view then follows the query until the field is cleared. Library
 * hides YT Music's results with no request. Answers to older queries are
 * dropped (Core's `stepYtSection`). With Search online set to Always, Online
 * is selected until Library is tapped (and again once the field is cleared),
 * so every query is asked once typing pauses, each search taking its turn in
 * the shared search allowance (`withSearchTurn`). When no song result matches
 * the query (Core's `ytSearchAsksVideos`), one Videos search follows, and its
 * matching official music videos show among the songs; a failed one shows none,
 * as a failed Community playlists search does.
 * Off in Settings, it stays hidden and nothing is asked. A [scope] narrows
 * it for a search embedded in another flow (DJ's: `YtSearchScope`), which
 * asks for no songs, videos or community playlists.
 */
export const useYtMusicSection = (
  query: string,
  libraryHasResults: boolean,
  scope?: YtSearchScope,
): readonly [YtSection<NativeYtSong>, (pick: YtPick) => void] => {
  const on = useYtMusicEnabled();
  // Followed, so a reconnect asks again for what's typed.
  const isOnline = useSyncExternalStore(subscribeConnectivity, online);
  const enabled = on && (scope === undefined || isOnline);
  // A search visit lasts until the field is cleared.
  const preferred = useSearchOnlineAlways(query === "");
  const always = scope === undefined ? preferred : true;
  const songless = scope !== undefined;
  const searchKind = songless ? "artistsAlbums" : "all";
  const [section, dispatch] = useReducer(stepYtSection<NativeYtSong>, YT_SECTION_HIDDEN);

  // Choosing Always asks for what's typed now; On demand leaves what shows until the field is cleared.
  useEffect(
    () => dispatch({ type: "typed", query, enabled, libraryHasResults, always }),
    [query, enabled, libraryHasResults, always],
  );

  const loading = section.status === "loading" ? section.query : null;
  const delayMs = section.status === "loading" ? section.delayMs : 0;
  // A query answered this session shows its answer before the frame is drawn, with no request.
  useLayoutEffect(() => {
    if (loading === null) return;
    const kept = keptYtSearch(loading, searchKind);
    if (kept === undefined) return;
    dispatch({ type: "found", query: loading, ...kept });
  }, [loading, searchKind]);
  useEffect(() => {
    if (loading === null || keptYtSearch(loading, searchKind) !== undefined) return undefined;
    const timer = setTimeout(() => {
      let found: Extract<YtSectionStep, { type: "found" }> | null = null;
      const step = (event: YtSectionStep) => {
        if (event.type === "found") found = event;
        dispatch(event);
      };
      const search = searchAll(loading, always, songless, step);
      void search.then((result) => {
        // The shelf joins the answer shown, if it is still this query's (Core's `stepYtSection`).
        if (Result.isSuccess(result)) {
          if (found !== null) {
            const { songs, artists, albums, videos } = found;
            keepYtSearch(loading, searchKind, {
              songs,
              artists,
              albums,
              videos,
              playlists: result.success.playlists,
            });
          }
          dispatch({ type: "playlistsFound", query: loading, playlists: result.success.playlists });
        }
        // Turned off meanwhile: the section is already hidden.
        else if (result.failure.reason !== "disabled")
          dispatch({ type: "failed", query: loading, reason: result.failure.reason });
      });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [loading, delayMs, always, songless, searchKind]);

  const pick = useCallback((picked: YtPick) => dispatch({ type: "picked", pick: picked }), []);
  return [section, pick] as const;
};

/**
 * Add Songs' song-only online search. Shares the Search section's settling,
 * connectivity, answer retention and stale-query rules without asking its
 * artist, album, video or community-playlist endpoints.
 */
export const useYtMusicSongsSection = (
  query: string,
): YtSection<NativeYtSong> => {
  const on = useYtMusicEnabled();
  const isOnline = useSyncExternalStore(subscribeConnectivity, online);
  const enabled = on && isOnline;
  const [section, dispatch] = useReducer(stepYtSection<NativeYtSong>, YT_SECTION_HIDDEN);

  useEffect(
    () => dispatch({ type: "typed", query, enabled, libraryHasResults: false, always: true }),
    [query, enabled],
  );

  const loading = section.status === "loading" ? section.query : null;
  const delayMs = section.status === "loading" ? section.delayMs : 0;
  useLayoutEffect(() => {
    if (loading === null) return;
    const kept = keptYtSearch(loading, "songs");
    if (kept !== undefined) dispatch({ type: "found", query: loading, ...kept });
  }, [loading]);
  useEffect(() => {
    if (loading === null || keptYtSearch(loading, "songs") !== undefined) return undefined;
    const timer = setTimeout(() => {
      let found: Extract<YtSectionStep, { type: "found" }> | null = null;
      const step = (event: YtSectionStep) => {
        if (event.type === "found") found = event;
        dispatch(event);
      };
      void searchSongsOnly(loading, step).then((result) => {
        if (Result.isSuccess(result)) {
          if (found !== null) {
            const { songs, artists, albums, videos } = found;
            keepYtSearch(loading, "songs", {
              songs,
              artists,
              albums,
              videos,
              playlists: [],
            });
          }
          dispatch({ type: "playlistsFound", query: loading, playlists: [] });
        } else if (result.failure.reason !== "disabled")
          dispatch({ type: "failed", query: loading, reason: result.failure.reason });
      });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [loading, delayMs]);

  return section;
};
