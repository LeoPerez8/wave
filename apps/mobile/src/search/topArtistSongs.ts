import {
  YT_SEARCH_ARTISTS_UNKNOWN,
  identityKey,
  ytArtistSavedStands,
  ytSearchArtistToRead,
  ytSearchArtistsKnownAfter,
  ytSearchTopArtistSongs,
  type YtSearchArtistsEvent,
  type YtSearchArtistsKnown,
  type YtSection,
  type YtSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useEffect, useMemo, useReducer, useRef } from "react";

import type { ArtistRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { fetchArtist, readSaved } from "@/ytmusic/artistSection";
import { withSearchTurn } from "@/ytmusic/searchAllowance";

/**
 * The artist [name]'s online answer as their page has it: the saved one while
 * it stands on the page (Core's `ytArtistSavedStands`), else read now and
 * saved, as their page's Online would (`fetchArtist`), once Search's turn in
 * the shared search allowance comes (`withSearchTurn`).
 */
const readArtistAnswer = (name: string, artistKey: string) =>
  Effect.gen(function* () {
    const saved = yield* readSaved(artistKey);
    if (ytArtistSavedStands(saved, Date.now())) return saved;
    return yield* withSearchTurn(
      "search",
      name,
      fetchArtist(name, artistKey, saved, { allSongs: true }),
    );
  });

type Known = YtSearchArtistsKnown<NativeYtSong>;

/** The merged song count of Search's top-hit Library artist. */
export interface TopArtistSongs {
  readonly artistId: number;
  readonly songs: number;
}

/**
 * The song count for Search's top hit when it's a Library [artist] (null: it
 * isn't): with Online, once YouTube Music's answer to the query shows, it
 * reads the artist's online page as their page does (reusing the saved answer
 * while it stands) and counts the Library's songs plus those it lacks
 * ([inLibrary]). Null while the Library's count stands: until then, on no
 * match, and with Library selected. A failed read isn't tried again this
 * visit until Online is tapped ([onlineTaps] moves). Core decides what's read
 * and what counts (`ytSearchArtistToRead`, `ytSearchTopArtistSongs`). Leaving
 * the tab's screen stops the read.
 */
export const useTopArtistSongs = (
  section: YtSection<NativeYtSong>,
  artist: ArtistRow | null,
  inLibrary: ((song: YtSong) => boolean) | null,
  onlineTaps: number,
): TopArtistSongs | null => {
  const [known, tell] = useReducer(
    (prev: Known, event: YtSearchArtistsEvent<NativeYtSong>) =>
      ytSearchArtistsKnownAfter(prev, event),
    YT_SEARCH_ARTISTS_UNKNOWN,
  );
  const name = artist?.name ?? null;
  const wanted = ytSearchArtistToRead(section, name, known);

  // Tapping Online tries a failed read again.
  useEffect(() => {
    if (onlineTaps > 0) tell({ kind: "onlineTapped" });
  }, [onlineTaps]);

  // The read under way: another artist on top replaces it; a query refined keeps it going.
  const flight = useRef<{ readonly key: string; readonly controller: AbortController } | null>(
    null,
  );
  useEffect(() => {
    if (wanted === null || name === null) return;
    if (flight.current?.key === wanted) return;
    flight.current?.controller.abort();
    const controller = new AbortController();
    flight.current = { key: wanted, controller };
    const settle = (event: YtSearchArtistsEvent<NativeYtSong>) => {
      if (flight.current?.controller === controller) flight.current = null;
      tell(event);
    };
    void appRuntime
      .runPromise(Effect.result(readArtistAnswer(name, wanted)), { signal: controller.signal })
      .then(
        (result) =>
          settle(
            Result.isSuccess(result)
              ? { kind: "read", key: wanted, saved: result.success, at: Date.now() }
              : { kind: "failed", key: wanted },
          ),
        // A defect fails like any other read; an interrupted one belongs to another artist.
        () => {
          if (!controller.signal.aborted) settle({ kind: "failed", key: wanted });
        },
      );
  }, [wanted, name]);
  useEffect(() => () => flight.current?.controller.abort(), []);

  return useMemo(() => {
    if (artist === null || inLibrary === null) return null;
    const songs = ytSearchTopArtistSongs(
      section,
      { artistKey: identityKey(artist.name), songs: artist.trackCount },
      known,
      { inLibrary },
    );
    return songs === null ? null : { artistId: artist.id, songs };
  }, [artist, inLibrary, known, section]);
};
