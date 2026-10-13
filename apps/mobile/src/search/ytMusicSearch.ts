import {
  YT_SEARCH_DEBOUNCE_MS,
  YT_SECTION_HIDDEN,
  stepYtSection,
  type YtSection,
} from "@wave/core";
import * as Result from "effect/Result";
import { useEffect, useReducer } from "react";

import type { NativeYtSong } from "@/native/waveYtMusic";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { askYtMusic } from "@/ytmusic/askYtMusic";

/**
 * The YT Music section for [query]: asked once typing pauses, off the typing
 * path, with answers to older queries dropped (Core's `stepYtSection`). Off in
 * Settings, it stays hidden and nothing is asked.
 */
export const useYtMusicSection = (query: string): YtSection<NativeYtSong> => {
  const enabled = useYtMusicEnabled();
  const [section, dispatch] = useReducer(stepYtSection<NativeYtSong>, YT_SECTION_HIDDEN);

  useEffect(() => dispatch({ type: "typed", query, enabled }), [query, enabled]);

  const loading = section.status === "loading" ? section.query : null;
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
    }, YT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  return section;
};
