import {
  YT_ARTIST_SECTION_START,
  identityKey,
  libraryAlbumFinder,
  pickYtArtist,
  stepYtArtistSection,
  ytArtistIntegrated,
  ytArtistLookup,
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
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

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
 * Asks YouTube Music for [name]'s page: the saved match's, or the one an
 * Artists search finds (Core's `ytArtistLookup`, `pickYtArtist`). The answer,
 * the page or "no match", is saved before it's shown; a request that gets no
 * answer saves nothing. Only the name and the artist's browse id are sent.
 */
const fetchArtist = (name: string, artistKey: string, saved: Saved | null) =>
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
        : { outcome: "found", checkedAt, browseId, page: yield* ytMusic.artist(browseId) };
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
 * The YouTube Music answer for the Library artist [name], as the artist page
 * and their albums' pages share it: it reads what was saved and never asks
 * YouTube Music until `show` is called (Core's `stepYtArtistSection`).
 */
export const useYtArtistAnswer = (name: string): YtArtistAnswer => {
  const artistKey = identityKey(name);
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
    void appRuntime.runPromise(Effect.result(fetchArtist(name, artistKey, saved))).then(
      (result) =>
        step(
          Result.isSuccess(result)
            ? { type: "answered", saved: result.success }
            : { type: "failed", reason: result.failure.reason },
        ),
      // A defect fails like any other request, so the section doesn't stay loading.
      () => step({ type: "failed", reason: "failed" }),
    );
  }, [name, artistKey, saved]);

  return { state, enabled, openedAt, show };
};

export interface YtArtistSectionShown {
  /** What the section shows, or null when it's hidden (Core's `ytArtistSectionView`). */
  readonly view: YtArtistSectionView<NativeYtSong> | null;
  /**
   * The artist's albums and singles under the top songs, each with the Library
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
 * saved, never asks YouTube Music until `show` is called, and hides with YT
 * Music off (Core's `stepYtArtistSection`). [artistId] and the page's Library
 * [albums] tell which of the artist's releases the Library already has.
 */
export const useYtArtistSection = (
  name: string,
  artistId: number,
  albums: readonly AlbumRow[],
): YtArtistSectionShown => {
  const { state, enabled, openedAt, show } = useYtArtistAnswer(name);
  const find = useLoadedLibraryFinder();
  const findAlbum = useMemo(() => libraryAlbumFinder(artistId, albums), [artistId, albums]);

  // Until the Library has been read, which top songs it lacks isn't known: nothing shows.
  const view =
    find === null
      ? null
      : ytArtistSectionView(state, {
          name,
          enabled,
          now: openedAt,
          inLibrary: (song) => find(song) !== null,
        });
  const shelves = useMemo(
    () => ytArtistShelves(state, { name, enabled, now: openedAt, libraryAlbum: findAlbum }),
    [state, name, enabled, openedAt, findAlbum],
  );
  const integrated = ytArtistIntegrated(state, { name, enabled, now: openedAt });
  return { view, shelves, integrated, show };
};
