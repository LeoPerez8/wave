import {
  identityKey,
  ytArtistPageAsks,
  ytSearchArtistReads,
  ytSearchArtistSongs,
  type YtArtistSaved,
  type YtSection,
  type YtSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ArtistRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { fetchArtist, readSaved } from "@/ytmusic/artistSection";
import { withSearchTurn } from "@/ytmusic/searchAllowance";

type Saved = YtArtistSaved<NativeYtSong>;

/**
 * The artist [name]'s online answer as their page has it: the saved one while
 * it stands on the page (a week, with every song of theirs), else read now
 * and saved, as their page's Online would (`fetchArtist`), once Search's turn
 * in the shared search allowance comes (`withSearchTurn`).
 */
const readArtistAnswer = (name: string, artistKey: string) =>
  Effect.gen(function* () {
    const saved = yield* readSaved(artistKey);
    const ready = { status: "ready", saved, failure: null } as const;
    if (saved !== null && !ytArtistPageAsks(ready, { enabled: true, now: Date.now() }))
      return saved;
    return yield* withSearchTurn(
      "search",
      name,
      fetchArtist(name, artistKey, saved, { allSongs: true }),
    );
  });

/** An artist's answer Search read, and when. */
interface Read {
  readonly saved: Saved;
  readonly at: number;
}

interface Known {
  /** The answers read during this visit, by artist key. */
  readonly answers: ReadonlyMap<string, Read>;
  /** The artists whose read failed, by artist key, with the query it failed for. */
  readonly failed: ReadonlyMap<string, string>;
}

const NOTHING_KNOWN: Known = { answers: new Map(), failed: new Map() };

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
 * ([inLibrary]; Core's `ytSearchArtistReads`, `ytSearchArtistSongs`). Null
 * while the Library's count stands: until then, on no match or a failure
 * (tried again for another query), and with Library selected. Leaving the
 * tab's screen stops the read.
 */
export const useTopArtistSongs = (
  section: YtSection<NativeYtSong>,
  artist: ArtistRow | null,
  inLibrary: ((song: YtSong) => boolean) | null,
): TopArtistSongs | null => {
  const [known, setKnown] = useState<Known>(NOTHING_KNOWN);
  const name = artist?.name ?? null;
  const key = name === null ? null : identityKey(name);
  const query = section.status === "results" ? section.query : null;
  const wanted =
    key !== null &&
    query !== null &&
    ytSearchArtistReads(section, name) &&
    !known.answers.has(key) &&
    known.failed.get(key) !== query
      ? key
      : null;

  // The read under way: another artist on top replaces it; a query refined keeps it going.
  const flight = useRef<{ readonly key: string; readonly controller: AbortController } | null>(
    null,
  );
  useEffect(() => {
    if (wanted === null || name === null || query === null) return;
    if (flight.current?.key === wanted) return;
    flight.current?.controller.abort();
    const controller = new AbortController();
    flight.current = { key: wanted, controller };
    const settle = (update: (prev: Known) => Known) => {
      if (flight.current?.controller === controller) flight.current = null;
      setKnown(update);
    };
    const failed = (prev: Known): Known => ({
      ...prev,
      failed: new Map(prev.failed).set(wanted, query),
    });
    void appRuntime
      .runPromise(Effect.result(readArtistAnswer(name, wanted)), { signal: controller.signal })
      .then(
        (result) =>
          settle(
            Result.isSuccess(result)
              ? (prev) => ({
                  ...prev,
                  answers: new Map(prev.answers).set(wanted, {
                    saved: result.success,
                    at: Date.now(),
                  }),
                })
              : failed,
          ),
        // A defect fails like any other read; an interrupted one belongs to another artist.
        () => {
          if (!controller.signal.aborted) settle(failed);
        },
      );
  }, [wanted, name, query]);
  useEffect(() => () => flight.current?.controller.abort(), []);

  return useMemo(() => {
    if (artist === null || key === null || inLibrary === null) return null;
    const read = known.answers.get(key);
    if (read === undefined) return null;
    const songs = ytSearchArtistSongs(section, artist.trackCount, read.saved, {
      now: read.at,
      inLibrary,
    });
    return songs === artist.trackCount ? null : { artistId: artist.id, songs };
  }, [artist, key, inLibrary, known, section]);
};
