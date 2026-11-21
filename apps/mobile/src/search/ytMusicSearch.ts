import {
  YT_SECTION_HIDDEN,
  stepYtSection,
  ytSearchAsksVideos,
  type YtPick,
  type YtSection,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useReducer } from "react";

import type { NativeYtSong } from "@/native/waveYtMusic";
import { useSearchOnlineAlways } from "@/settings/searchOnline";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import type { YtMusicError } from "@/ytmusic/YtMusic";

/**
 * [search] for [query]: asked as you type ([always], Search online set to
 * Always), it waits its turn in the shared search allowance; otherwise at once.
 */
const inTurn = <A, R>(
  always: boolean,
  query: string,
  search: Effect.Effect<A, YtMusicError, R>,
): Effect.Effect<A, YtMusicError, R> => (always ? withSearchTurn("search", query, search) : search);

/** What a search embedded in another flow asks YT Music for, in place of the Search tab's. */
export interface YtSearchScope {
  /**
   * Artists and albums alone, every query asked once typing pauses whatever
   * Search online says (the flow has no Library | Online toggle).
   */
  readonly artistsAndAlbums: true;
  /** Whether the phone is online now; offline, nothing is asked and the Library's results stand alone. */
  readonly online: () => boolean;
}

/**
 * What Search has asked YT Music for [query] (its songs, artists and albums,
 * asked together), and what picking a segment of the Library | Online toggle
 * does. Typing alone asks only when the Library has nothing for the query
 * ([libraryHasResults] false) and Library wasn't picked, once typing pauses;
 * Online asks at once (or shows again what it already has for the query),
 * and the view then follows the query until the field is cleared. Library
 * hides YT Music's results with no request. Answers to older queries are
 * dropped (Core's `stepYtSection`). With Search online set to Always, Online
 * is selected until Library is tapped (and again once the field is cleared),
 * so every query is asked once typing pauses, each search taking its turn in
 * the shared search allowance (`withSearchTurn`). When no song result matches
 * the query (Core's `ytSearchAsksVideos`), one Videos search follows, and its
 * matching official music videos show among the songs; a failed one shows none.
 * Off in Settings, it stays hidden and nothing is asked. A [scope] narrows
 * it for a search embedded in another flow (DJ's: `YtSearchScope`).
 */
export const useYtMusicSection = (
  query: string,
  libraryHasResults: boolean,
  scope?: YtSearchScope,
): readonly [YtSection<NativeYtSong>, (pick: YtPick) => void] => {
  const on = useYtMusicEnabled();
  const enabled = on && (scope === undefined || scope.online());
  // A search visit lasts until the field is cleared.
  const preferred = useSearchOnlineAlways(query === "");
  const always = scope === undefined ? preferred : true;
  const songless = scope !== undefined;
  const [section, dispatch] = useReducer(stepYtSection<NativeYtSong>, YT_SECTION_HIDDEN);

  // Choosing Always asks for what's typed now; On demand leaves what shows until the field is cleared.
  useEffect(
    () => dispatch({ type: "typed", query, enabled, libraryHasResults, always }),
    [query, enabled, libraryHasResults, always],
  );

  const loading = section.status === "loading" ? section.query : null;
  const delayMs = section.status === "loading" ? section.delayMs : 0;
  useEffect(() => {
    if (loading === null) return undefined;
    const timer = setTimeout(() => {
      // Only the query is sent. One that fails fails them all: one quiet line.
      const search = askYtMusic((ytMusic) =>
        Effect.gen(function* () {
          const found = yield* Effect.all(
            {
              songs: songless
                ? Effect.succeed({ songs: [] as NativeYtSong[] })
                : inTurn(always, loading, ytMusic.searchSongs(loading)),
              artists: inTurn(always, loading, ytMusic.searchArtists(loading)),
              albums: inTurn(always, loading, ytMusic.searchAlbums(loading)),
            },
            { concurrency: "unbounded" },
          );
          const videos =
            !songless && ytSearchAsksVideos(loading, found.songs.songs)
              ? yield* inTurn(always, loading, ytMusic.searchVideos(loading)).pipe(
                  Effect.map((page) => page.songs),
                  Effect.orElseSucceed(() => []),
                )
              : undefined;
          return { ...found, videos };
        }),
      );
      void search.then((result) => {
        if (Result.isSuccess(result)) {
          const { songs, artists, albums, videos } = result.success;
          dispatch({ type: "found", query: loading, songs: songs.songs, artists, albums, videos });
        }
        // Turned off meanwhile: the section is already hidden.
        else if (result.failure.reason !== "disabled")
          dispatch({ type: "failed", query: loading, reason: result.failure.reason });
      });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [loading, delayMs, always, songless]);

  const pick = useCallback((picked: YtPick) => dispatch({ type: "picked", pick: picked }), []);
  return [section, pick] as const;
};
