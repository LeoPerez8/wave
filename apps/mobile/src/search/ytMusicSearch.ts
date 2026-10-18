import { YT_SECTION_HIDDEN, stepYtSection, type YtPick, type YtSection } from "@wave/core";
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
 * the shared search allowance (`withSearchTurn`). Off in Settings, it stays
 * hidden and nothing is asked.
 */
export const useYtMusicSection = (
  query: string,
  libraryHasResults: boolean,
): readonly [YtSection<NativeYtSong>, (pick: YtPick) => void] => {
  const enabled = useYtMusicEnabled();
  const always = useSearchOnlineAlways();
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
        Effect.all(
          {
            songs: inTurn(always, loading, ytMusic.searchSongs(loading)),
            artists: inTurn(always, loading, ytMusic.searchArtists(loading)),
            albums: inTurn(always, loading, ytMusic.searchAlbums(loading)),
          },
          { concurrency: "unbounded" },
        ),
      );
      void search.then((result) => {
        if (Result.isSuccess(result)) {
          const { songs, artists, albums } = result.success;
          dispatch({ type: "found", query: loading, songs: songs.songs, artists, albums });
        }
        // Turned off meanwhile: the section is already hidden.
        else if (result.failure.reason !== "disabled")
          dispatch({ type: "failed", query: loading, reason: result.failure.reason });
      });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [loading, delayMs, always]);

  const pick = useCallback((picked: YtPick) => dispatch({ type: "picked", pick: picked }), []);
  return [section, pick] as const;
};
