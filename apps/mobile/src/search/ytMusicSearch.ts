import { YT_SECTION_HIDDEN, stepYtSection, type YtSection } from "@wave/core";
import * as Result from "effect/Result";
import { useCallback, useEffect, useReducer } from "react";

import type { NativeYtSong } from "@/native/waveYtMusic";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { askYtMusic } from "@/ytmusic/askYtMusic";

/**
 * What Search has asked YT Music for [query], and Search YouTube Music's
 * action. Typing alone asks only when the Library has nothing for the query
 * ([libraryHasResults] false), once typing pauses; a tap asks at once, and the
 * view then follows the query until the field is cleared. Answers to older
 * queries are dropped (Core's `stepYtSection`). Off in Settings, it stays
 * hidden and nothing is asked.
 */
export const useYtMusicSection = (
  query: string,
  libraryHasResults: boolean,
): readonly [YtSection<NativeYtSong>, () => void] => {
  const enabled = useYtMusicEnabled();
  const [section, dispatch] = useReducer(stepYtSection<NativeYtSong>, YT_SECTION_HIDDEN);

  useEffect(
    () => dispatch({ type: "typed", query, enabled, libraryHasResults }),
    [query, enabled, libraryHasResults],
  );

  const loading = section.status === "loading" ? section.query : null;
  const delayMs = section.status === "loading" ? section.delayMs : 0;
  useEffect(() => {
    if (loading === null) return undefined;
    const timer = setTimeout(() => {
      void askYtMusic((ytMusic) => ytMusic.searchSongs(loading)).then((result) => {
        if (Result.isSuccess(result))
          dispatch({ type: "found", query: loading, songs: result.success.songs });
        // Turned off meanwhile: the section is already hidden.
        else if (result.failure.reason !== "disabled")
          dispatch({ type: "failed", query: loading, reason: result.failure.reason });
      });
    }, delayMs);
    return () => clearTimeout(timer);
  }, [loading, delayMs]);

  const ask = useCallback(() => dispatch({ type: "asked" }), []);
  return [section, ask] as const;
};
