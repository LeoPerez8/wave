import {
  YT_ARTIST_SECTION_START,
  identityKey,
  libraryAlbumFinder,
  pickYtArtist,
  stepYtArtistSection,
  ytArtistIntegrated,
  ytArtistLookup,
  ytArtistSectionAsks,
  ytArtistSectionView,
  ytArtistShelves,
  type YtArtistSaved,
  type YtArtistSection,
  type YtArtistSectionEvent,
  type YtArtistSectionView,
  type YtArtistShelf,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { LibraryStore, type AlbumRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { useLoadedLibraryFinder } from "./libraryFinder";
import { YtMusic, YtMusicError } from "./YtMusic";

type Saved = YtArtistSaved<NativeYtSong>;

/** What was saved for the artist; nothing when it can't be read. */
const readSaved = (artistKey: string) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    return yield* store.ytArtist(artistKey);
  }).pipe(Effect.orElseSucceed(() => null));

/**
 * The artist page [browseId] with every song of the artist (`allSongs`): the
 * Songs shelf's playlist read whole after the page (Core's `readYtPlaylist`,
 * with its cap), or the top songs when the page has none. A playlist page
 * that fails fails it all, so a half-read list is never saved. A Library
 * artist's section and a YouTube Music artist page both read it so.
 */
export const readArtist = (browseId: string) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const page = yield* ytMusic.artist(browseId);
    const playlistId = page.songsPlaylistId ?? null;
    const allSongs = playlistId === null ? page.songs : (yield* ytMusic.playlist(playlistId)).songs;
    return { ...page, allSongs };
  });

/**
 * Asks YouTube Music for [name]'s page: the saved match's, or the one an
 * Artists search finds (Core's `ytArtistLookup`, `pickYtArtist`), then the
 * playlist of every song of theirs. The answer, the page or "no match", is
 * saved before it's shown; a request that gets no answer saves nothing. Only
 * the name, the artist's browse id and their songs playlist's id are sent.
 */
export const fetchArtist = (name: string, artistKey: string, saved: Saved | null) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const store = yield* LibraryStore;
    const lookup = ytArtistLookup(name, saved);
    if (lookup === null) return yield* new YtMusicError({ reason: "failed" });
    const browseId =
      lookup.kind === "page"
        ? lookup.browseId
        : pickYtArtist(name, yield* ytMusic.searchArtists(lookup.query));
    const checkedAt = Date.now();
    const answer: Saved =
      browseId === null
        ? { outcome: "unmatched", checkedAt }
        : { outcome: "found", checkedAt, browseId, page: yield* readArtist(browseId) };
    // Not saved, it's still shown; the next opening asks again.
    yield* store.saveYtArtist(artistKey, answer).pipe(Effect.ignore);
    return answer;
  });

/** The section's state for the artist [key]: what was read and asked for them. */
interface Keyed {
  readonly key: string;
  readonly state: YtArtistSection<NativeYtSong>;
}

/**
 * Core's `stepYtArtistSection` for one artist at a time: what's read for
 * another artist starts over from it, and other answers about an artist the
 * page no longer shows are dropped.
 */
const stepKeyed = (
  keyed: Keyed,
  { key, event }: { readonly key: string; readonly event: YtArtistSectionEvent<NativeYtSong> },
): Keyed => {
  if (key === keyed.key) return { key, state: stepYtArtistSection(keyed.state, event) };
  if (event.type !== "restored") return keyed;
  return { key, state: stepYtArtistSection(YT_ARTIST_SECTION_START, event) };
};

/** Asks YouTube Music for an artist given what was saved, and saves the answer. */
export type AskArtist = (
  saved: Saved | null,
) => Effect.Effect<Saved, YtMusicError, YtMusic | LibraryStore>;

/** What was saved for an artist, and asking YouTube Music again. */
export interface YtArtistAnswer {
  /** Core's `stepYtArtistSection` state: what's saved, and whether a tap is being answered. */
  readonly state: YtArtistSection<NativeYtSong>;
  /** Whether YT Music is on in Settings. */
  readonly enabled: boolean;
  /** When the screen opened: whether a saved answer still stands is decided then. */
  readonly openedAt: number;
  /** Show on YouTube Music: asks YouTube Music, once. */
  readonly show: () => void;
}

/**
 * The YouTube Music answer saved under [artistKey]: it reads what was saved
 * and never asks YouTube Music until `show` is called, which runs [ask]
 * (Core's `stepYtArtistSection`).
 */
export const useSavedYtArtist = (artistKey: string, ask: AskArtist): YtArtistAnswer => {
  const enabled = useYtMusicEnabled();
  const [keyed, dispatch] = useReducer(stepKeyed, {
    key: artistKey,
    state: YT_ARTIST_SECTION_START,
  });
  // A page whose artist is read later (an album's) starts over once it is.
  const state = keyed.key === artistKey ? keyed.state : YT_ARTIST_SECTION_START;
  // Whether a saved answer still stands is decided as the page opens (an answer
  // that comes later is newer, so it stands).
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    let current = true;
    const restored = (saved: Saved | null) => {
      if (current) dispatch({ key: artistKey, event: { type: "restored", saved } });
    };
    void appRuntime
      .runPromise(readSaved(artistKey))
      // A defect reads as nothing saved, so the section can still ask.
      .then(restored, () => restored(null));
    return () => {
      current = false;
    };
  }, [artistKey]);

  // What's saved, while a tap can ask (undefined while reading or asking).
  const saved = state.status === "ready" ? state.saved : undefined;
  const show = useCallback(() => {
    if (saved === undefined) return;
    const step = (event: YtArtistSectionEvent<NativeYtSong>) => dispatch({ key: artistKey, event });
    step({ type: "requested" });
    void appRuntime.runPromise(Effect.result(ask(saved))).then(
      (result) =>
        step(
          Result.isSuccess(result)
            ? { type: "answered", saved: result.success }
            : { type: "failed", reason: result.failure.reason },
        ),
      // A defect fails like any other request, so the section doesn't stay loading.
      () => step({ type: "failed", reason: "failed" }),
    );
  }, [artistKey, ask, saved]);

  return { state, enabled, openedAt, show };
};

/**
 * The YouTube Music answer for the Library artist [name], as the artist page
 * and their albums' pages share it: it reads what was saved and never asks
 * YouTube Music until `show` is called (Core's `stepYtArtistSection`).
 */
export const useYtArtistAnswer = (name: string): YtArtistAnswer => {
  const artistKey = identityKey(name);
  const ask = useCallback(
    (saved: Saved | null) => fetchArtist(name, artistKey, saved),
    [name, artistKey],
  );
  return useSavedYtArtist(artistKey, ask);
};

export interface YtArtistSectionShown {
  /** What the section shows, or null when it's hidden (Core's `ytArtistSectionView`). */
  readonly view: YtArtistSectionView<NativeYtSong> | null;
  /**
   * The artist's albums and singles under their songs, each with the Library
   * album it already is (Core's `ytArtistShelves`, `libraryAlbumFinder`).
   */
  readonly shelves: readonly YtArtistShelf<AlbumRow>[];
  /**
   * Whether the page is an integrated view (Core's `ytArtistIntegrated`): its
   * Library albums open integrated too.
   */
  readonly integrated: boolean;
  /** Show on YouTube Music: asks YouTube Music, once. */
  readonly show: () => void;
}

/**
 * The YT Music section at the end of [name]'s artist page. It reads what was
 * saved and hides with YT Music off (Core's `stepYtArtistSection`). It never
 * asks YouTube Music until `show` is called unless the page was opened
 * integrated ([openedIntegrated], from a streamed song's artist): then, with
 * nothing standing for the artist, it asks once on its own (Core's
 * `ytArtistSectionAsks`). [artistId] and the page's Library [albums] tell
 * which of the artist's releases the Library already has.
 */
export const useYtArtistSection = (
  name: string,
  artistId: number,
  albums: readonly AlbumRow[],
  openedIntegrated: boolean,
): YtArtistSectionShown => {
  const { state, enabled, openedAt, show } = useYtArtistAnswer(name);
  const asks = ytArtistSectionAsks(state, {
    name,
    enabled,
    now: openedAt,
    integrated: openedIntegrated,
  });
  // Once per state: a remounted effect doesn't send the request twice.
  const askedFor = useRef<unknown>(null);
  useEffect(() => {
    if (!asks || askedFor.current === state) return;
    askedFor.current = state;
    show();
  }, [asks, state, show]);
  const find = useLoadedLibraryFinder();
  const findAlbum = useMemo(() => libraryAlbumFinder(artistId, albums), [artistId, albums]);

  // Until the Library has been read, which songs it lacks isn't known: nothing shows.
  // Memoized: it filters every song of the artist, and the page's memos key on it.
  const view = useMemo(
    () =>
      find === null
        ? null
        : ytArtistSectionView(state, {
            name,
            enabled,
            now: openedAt,
            integrated: openedIntegrated,
            inLibrary: (song) => find(song) !== null,
          }),
    [find, state, name, enabled, openedAt, openedIntegrated],
  );
  const shelves = useMemo(
    () => ytArtistShelves(state, { name, enabled, now: openedAt, libraryAlbum: findAlbum }),
    [state, name, enabled, openedAt, findAlbum],
  );
  const integrated = ytArtistIntegrated(state, { name, enabled, now: openedAt });
  return { view, shelves, integrated, show };
};
