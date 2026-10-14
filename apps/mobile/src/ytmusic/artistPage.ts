import {
  identityKey,
  libraryAlbumFinder,
  libraryArtistFinder,
  ytArtistPageAsks,
  ytArtistPageView,
  type YtArtistAlbum,
  type YtArtistPageView,
  type YtArtistSaved,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useAlbums, useArtists } from "@/library/hooks";
import { LibraryStore, type AlbumRow, type SongRow } from "@/library/LibraryStore";
import type { NativeYtSong } from "@/native/waveYtMusic";

import { fetchArtist, useSavedYtArtist } from "./artistSection";
import { useLoadedLibraryFinder } from "./libraryFinder";
import { YtMusic } from "./YtMusic";

type Saved = YtArtistSaved<NativeYtSong>;

/**
 * Where a YouTube Music artist page's answer is saved (`yt_artists`): by
 * browse id, apart from the Library artists' names.
 */
const savedKey = (browseId: string): string => `yt:${browseId}`;

/** Reads the artist page [browseId] and saves it before it's shown. Only the browse id is sent. */
const fetchPage = (browseId: string) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const store = yield* LibraryStore;
    const page = yield* ytMusic.artist(browseId);
    const answer: Saved = { outcome: "found", checkedAt: Date.now(), browseId, page };
    // Not saved, it's still shown; the next opening asks again.
    yield* store.saveYtArtist(savedKey(browseId), answer).pipe(Effect.ignore);
    return answer;
  });

const nowhere = (): null => null;

/**
 * Which of the artist [name]'s releases the Library has: the albums of the
 * Library artist that name is (Core's `libraryArtistFinder`,
 * `libraryAlbumFinder`). Without one, none.
 */
const useLibraryReleases = (name: string | null): ((album: YtArtistAlbum) => AlbumRow | null) => {
  const artists = useArtists();
  const albums = useAlbums();
  const artistNamed = useMemo(() => libraryArtistFinder(artists), [artists]);
  const artist = name === null ? null : artistNamed(name);
  const artistId = artist?.id ?? null;
  return useMemo(
    () => (artistId === null ? nowhere : libraryAlbumFinder(artistId, albums)),
    [artistId, albums],
  );
};

export interface YtArtistPageShown {
  /**
   * What the page shows (Core's `ytArtistPageView`), or null until the
   * Library has been read, so its songs never show streamed first.
   */
  readonly view: YtArtistPageView<NativeYtSong, SongRow, AlbumRow> | null;
  /** Try Again: asks YouTube Music once more. */
  readonly retry: () => void;
}

/**
 * The YouTube Music artist page [browseId]: what was saved for it shows for a
 * week; otherwise it's read as the page opens, the user having asked for it
 * by opening it (Core's `ytArtistPageAsks`). [knownName] is the name the
 * opener knew, until the page says. Opened by name (no [browseId]), the
 * artist is found as a Library artist's section finds them, an Artists search
 * for [knownName], and the answer, "no match" included, is saved under that
 * name, as a Library artist's is (`fetchArtist`).
 */
export const useYtArtistPage = (
  browseId: string | null,
  knownName: string | null,
): YtArtistPageShown => {
  const byName = browseId === null ? (knownName ?? "") : null;
  const key = byName === null ? savedKey(browseId ?? "") : identityKey(byName);
  const ask = useCallback(
    (saved: Saved | null) =>
      byName === null ? fetchPage(browseId ?? "") : fetchArtist(byName, key, saved),
    [browseId, byName, key],
  );
  const { state, enabled, openedAt, show } = useSavedYtArtist(key, ask);

  const asks = ytArtistPageAsks(state, { enabled, now: openedAt });
  // Once per state: a remounted effect doesn't send the request twice.
  const askedFor = useRef<unknown>(null);
  useEffect(() => {
    if (!asks || askedFor.current === state) return;
    askedFor.current = state;
    show();
  }, [asks, state, show]);

  const saved = state.status === "reading" ? null : state.saved;
  const name = (saved?.outcome === "found" ? saved.page.name : null) ?? knownName;
  const find = useLoadedLibraryFinder();
  const libraryAlbum = useLibraryReleases(name);
  const view = useMemo(
    () =>
      find === null
        ? null
        : ytArtistPageView(state, { enabled, now: openedAt, librarySong: find, libraryAlbum }),
    [find, state, enabled, openedAt, libraryAlbum],
  );
  return { view, retry: show };
};
