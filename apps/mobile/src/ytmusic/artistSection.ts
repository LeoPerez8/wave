import {
  YT_ARTIST_SECTION_START,
  identityKey,
  inLibraryUnlessHeld,
  libraryAlbumFinder,
  stepYtArtistSection,
  ytArtistCounts,
  ytArtistFullPage,
  ytArtistIntegrated,
  ytArtistOpening,
  ytArtistOpeningState,
  ytArtistSectionView,
  ytArtistShelves,
  type HeldSongs,
  type YtArtistCounts,
  type YtArtistSaved,
  type YtArtistSection,
  type YtArtistSectionEvent,
  type YtArtistSectionView,
  type YtArtistShelf,
  type YtArtistSongsRead,
  type YtPick,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { LineToggle } from "@/catalog/PlayShuffle";
import { LibraryStore, type AlbumRow, type SongRow } from "@/library/LibraryStore";
import { useScreenSettled } from "@/lib/screenTiming";
import { useScreenSight } from "@/lib/screenSight";
import { isScreenSettled } from "@/lib/timing";
import { appRuntime } from "@/library/runtime";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { online } from "@/native/waveNative";
import { searchOnlineAlwaysNow, useSearchOnlineAlways } from "@/settings/searchOnline";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { fetchArtistAnswer } from "./artistFetch";
import { readArtistPage } from "./candidateCatalog";
import { artistPopularSongs, createArtistOpeningRead } from "./artistOpeningRead";
import { searchAllowanceSnapshot, withSearchTurn } from "./searchAllowance";
import { artistOpeningRequest } from "./artistOpeningRequest";
import { libraryFinderForRows, useLoadedLibraryFinder, type FindInLibrary } from "./libraryFinder";
import { useLineToggle } from "./OnlineToggle";
import { YtMusic, YtMusicError } from "./YtMusic";

type Saved = YtArtistSaved<NativeYtSong>;

/** What was saved for the artist; nothing when it can't be read. */
export const readSaved = (artistKey: string) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    return yield* store.ytArtist(artistKey);
  }).pipe(Effect.orElseSucceed(() => null));

/**
 * The artist page [browseId] with every song of the artist (`allSongs`): the
 * Songs shelf's playlist read after the page (Core's `readYtPlaylist`, with
 * its cap), or the top songs when the page has none or YouTube can't give it.
 * Offline, or a later playlist page failing, fails it all, so a half-read
 * list is never saved (Core's `ytArtistFullPage`). Interrupted, it asks for
 * no further page. A Library artist's section and a YouTube Music artist page
 * both read it so.
 */
export const readArtist = (browseId: string, canSend: () => boolean = online) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const page = yield* artistOpeningRequest(canSend, readArtistPage(browseId)).pipe(
      Effect.mapError((error) => new YtMusicError({ reason: error.reason })),
    );
    const playlistId = page.songsPlaylistId ?? null;
    let read: YtArtistSongsRead<NativeYtSong> | null = null;
    if (playlistId !== null) {
      let pagesRead = 0;
      const onPage = () => {
        pagesRead += 1;
      };
      const result = yield* Effect.result(ytMusic.playlist(playlistId, { onPage, canSend }));
      read = Result.isSuccess(result)
        ? { status: "read", songs: result.success.songs, truncated: result.success.truncated }
        : { status: "failed", reason: result.failure.reason, pagesRead };
    }
    const full = ytArtistFullPage(page, read);
    if (full.status === "failed") return yield* new YtMusicError({ reason: full.reason });
    return full.page;
  });

/** How much of the artist an ask reads. */
export interface ArtistReads {
  /**
   * Every song of theirs too (`readArtist`), as the artist's pages want; a
   * Library album's page only needs their releases, so it reads the page only.
   */
  readonly allSongs: boolean;
  /** The deferred artist boundary shares the search allowance and rechecks consent after a wait. */
  readonly canSend?: () => boolean;
}

/**
 * Asks YouTube Music for [name]'s page: the saved match's, or the one an
 * Artists search finds (Core's `ytArtistLookup`, `pickYtArtist`), then, when
 * [reads] asks for it, the playlist of every song of theirs. The answer, the
 * page or "no match", is saved before it's shown, unless it's the page alone
 * and what was saved meanwhile stands with the full list: that stays and is
 * shown (Core's `ytArtistAnswerKept`). A request that gets no answer, or is
 * interrupted, saves nothing. Only the name, the artist's browse id and their
 * songs playlist's id are sent.
 */
export const fetchArtist = (
  name: string,
  artistKey: string,
  saved: Saved | null,
  reads: ArtistReads,
) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const store = yield* LibraryStore;
    const canSend = reads.canSend ?? online;
    return yield* fetchArtistAnswer(name, saved, {
      canSend,
      search: (query) =>
        reads.canSend === undefined
          ? ytMusic.searchArtists(query)
          : withSearchTurn(
              "search",
              query,
              artistOpeningRequest(reads.canSend, ytMusic.searchArtists(query)).pipe(
                Effect.mapError((error) => new YtMusicError({ reason: error.reason })),
              ),
            ),
      page: (browseId) =>
        reads.allSongs ? readArtist(browseId, canSend) : readArtistPage(browseId),
      saved: readSaved(artistKey),
      save: (answer) => store.saveYtArtist(artistKey, answer).pipe(Effect.ignore),
    }).pipe(Effect.mapError((error) => new YtMusicError({ reason: error.reason })));
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
  /** Asks YouTube Music, once (Online picked, or the page opened integrated). */
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
  // Aborted once the page is gone (or shows another artist): what it reads
  // and asks for the artist stops, and a request saves nothing, so nothing
  // is read in the background.
  const leaving = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    leaving.current = controller;
    const restored = (saved: Saved | null) => {
      if (!controller.signal.aborted)
        dispatch({ key: artistKey, event: { type: "restored", saved } });
    };
    void appRuntime
      .runPromise(readSaved(artistKey), { signal: controller.signal })
      // A defect reads as nothing saved, so the section can still ask.
      .then(restored, () => restored(null));
    return () => controller.abort();
  }, [artistKey]);

  // What's saved, while a tap can ask (undefined while reading or asking).
  const saved = state.status === "ready" ? state.saved : undefined;
  const show = useCallback(() => {
    if (saved === undefined) return;
    const step = (event: YtArtistSectionEvent<NativeYtSong>) => dispatch({ key: artistKey, event });
    const signal = leaving.current?.signal;
    step({ type: "requested" });
    void appRuntime.runPromise(Effect.result(ask(saved)), { signal }).then(
      (result) =>
        step(
          Result.isSuccess(result)
            ? { type: "answered", saved: result.success }
            : { type: "failed", reason: result.failure.reason },
        ),
      // A defect fails like any other request, so the section doesn't stay
      // loading; an interrupted one belongs to a page that's gone.
      () => {
        if (signal?.aborted !== true) step({ type: "failed", reason: "failed" });
      },
    );
  }, [artistKey, ask, saved]);

  return { state, enabled, openedAt, show };
};

/**
 * The YouTube Music answer for the Library artist [name], as the artist page
 * and their albums' pages share it: it reads what was saved and never asks
 * YouTube Music until `show` is called (Core's `stepYtArtistSection`). [reads]
 * says whether asking reads every song of theirs too (`fetchArtist`).
 */
export const useYtArtistAnswer = (name: string, reads: ArtistReads): YtArtistAnswer => {
  const artistKey = identityKey(name);
  const { allSongs } = reads;
  const ask = useCallback(
    (saved: Saved | null) =>
      artistOpeningRequest(online, fetchArtist(name, artistKey, saved, { allSongs })).pipe(
        Effect.mapError((error) => new YtMusicError({ reason: error.reason })),
      ),
    [name, artistKey, allSongs],
  );
  return useSavedYtArtist(artistKey, ask);
};

export interface YtArtistSectionShown {
  /** Shared only while online additions are shown, after the local page settles. */
  readonly find: FindInLibrary | null;
  /** What the section shows, or null when it's hidden (Core's `ytArtistSectionView`). */
  readonly view: YtArtistSectionView<NativeYtSong> | null;
  /**
   * The artist's albums and singles under their songs, each with the Library
   * album it already is (Core's `ytArtistShelves`, `libraryAlbumFinder`).
   */
  readonly shelves: readonly YtArtistShelf<AlbumRow>[];
  /**
   * The artist's YouTube Music song list, in its order, once it's known: what
   * Popular ranks the Library's songs by (`rankPopular`). Null until then.
   */
  readonly popular: readonly NativeYtSong[] | null;
  /**
   * Whether the page is an integrated view (Core's `ytArtistIntegrated`): its
   * Library albums open integrated too.
   */
  readonly integrated: boolean;
  /** The page's Library | Online toggle, or null when it has none (YT Music off…). */
  readonly toggle: LineToggle | null;
  /**
   * The header's album and song counts from the Library's [local] ones: with
   * Online and a match standing, what the page draws (Core's `ytArtistCounts`).
   */
  readonly counts: (local: YtArtistCounts) => YtArtistCounts;
}

/**
 * The YT Music section of [name]'s artist page and its Library | Online
 * toggle. It reads what was saved and hides with YT Music off (Core's
 * `stepYtArtistSection`). It asks YouTube Music only once Online is selected
 * with nothing standing for the artist: picked, or the page opened integrated
 * ([openedIntegrated], from a streamed song's artist) or with Search online
 * set to Always (Core's `ytArtistSectionAsks`); after a failure, picking
 * Online asks again. A long press on the toggle opens the Search online
 * card (`openSearchOnlineChoices`). Library
 * hides what YouTube Music added, with no request. Popular uses that same saved
 * answer and never starts a separate request. [artistId] and the page's
 * Library [albums] tell which of the artist's releases the Library already
 * has. The songs the page [held] in place this visit stay among the
 * section's, downloaded or not (Core's `inLibraryUnlessHeld`).
 */
export const useYtArtistSection = (
  name: string,
  artistId: number,
  albums: readonly AlbumRow[],
  openedIntegrated: boolean,
  held: HeldSongs<NativeYtSong>,
  contentReady: boolean,
): YtArtistSectionShown => {
  const always = useSearchOnlineAlways();
  // The toggle's segment picked while the page is open; null until one is.
  const [pick, setPick] = useState<YtPick | null>(null);
  const { state, enabled, openedAt, show, find, select } = useDeferredArtistSection(
    name,
    contentReady,
    openedIntegrated,
    always,
    pick,
  );
  const popular = artistPopularSongs(state);
  const findAlbum = useMemo(() => libraryAlbumFinder(artistId, albums), [artistId, albums]);

  const connected = online();
  // The Library toggle needs no finder; online additions wait for its deferred read.
  // Memoized: it filters every song of the artist, and the page's memos key on it.
  const view = useMemo(() => {
    const shownState: YtArtistSection<NativeYtSong> = ytArtistOpeningState(state, connected);
    const section = ytArtistSectionView(shownState, {
      name,
      enabled,
      now: openedAt,
      integrated: openedIntegrated,
      always,
      pick,
      inLibrary: inLibraryUnlessHeld(held, (song) => find === null || find(song) !== null),
    });
    // The toggle and local rows never wait for the finder. Online rows and counts do.
    return find === null &&
      section?.toggle === "online" &&
      (section.note === null || section.note === "allInLibrary" || section.note === "noSongs")
      ? { ...section, songs: [], note: "loading" as const }
      : section;
  }, [find, state, name, enabled, openedAt, openedIntegrated, always, pick, held, connected]);
  const shelves = useMemo(
    () =>
      find === null
        ? []
        : ytArtistShelves(state, { name, enabled, now: openedAt, libraryAlbum: findAlbum, pick }),
    [find, state, name, enabled, openedAt, findAlbum, pick],
  );
  const integrated = ytArtistIntegrated(state, { name, enabled, now: openedAt, pick });
  const retry = view?.retry === true;
  const onPick = useCallback(
    (next: YtPick) => {
      select(next);
      setPick(next);
      // Online after an ask that got no answer asks again.
      if (next === "online" && retry) show();
    },
    [retry, show, select],
  );
  const toggle = useLineToggle(view?.toggle, onPick);
  // The Library's files of songs held in place count as the Library's, as the page draws them once.
  const counts = useCallback(
    (local: YtArtistCounts) =>
      find === null
        ? local
        : ytArtistCounts(state, {
            name,
            enabled,
            now: openedAt,
            integrated: openedIntegrated,
            always,
            pick,
            local,
            inLibrary: (song) => find(song) !== null,
            libraryRelease: (album) => findAlbum(album) !== null,
          }),
    [find, state, name, enabled, openedAt, openedIntegrated, always, pick, findAlbum],
  );
  return { view, shelves, popular, integrated, toggle, counts, find };
};

/**
 * Reviewed online boundary: wait for local content and screen settlement even
 * for Always/integrated openings and retries. A standing saved online page
 * needs the shared finder; Library mode and missing/partial/expired answers do not.
 */
const useDeferredArtistSection = (
  name: string,
  contentReady: boolean,
  integrated: boolean,
  always: boolean,
  pick: YtPick | null,
) => {
  const settled = useScreenSettled();
  const sight = useScreenSight();
  const enabled = useYtMusicEnabled();
  const [reader] = useState(() =>
    createArtistOpeningRead<NativeYtSong>({
      restore: (key, signal) => appRuntime.runPromise(readSaved(key), { signal }),
      request: (artistName, key, saved, signal, canSend) =>
        appRuntime
          .runPromise(
            Effect.result(
              artistOpeningRequest(
                canSend,
                fetchArtist(artistName, key, saved, { allSongs: true, canSend }),
              ),
            ),
            { signal },
          )
          .then((result) => {
            if (Result.isFailure(result)) throw result.failure;
            return result.success;
          }),
      online,
      settled: () => sight.visible() && isScreenSettled(),
      allowance: searchAllowanceSnapshot,
      always: searchOnlineAlwaysNow,
    }),
  );
  const snapshot = useSyncExternalStore(reader.subscribe, reader.snapshot);
  const artistKey = identityKey(name);
  const state = snapshot.key === artistKey ? snapshot.state : YT_ARTIST_SECTION_START;
  const openedAt = snapshot.openedAt;
  useEffect(() => {
    reader.open(name);
    return reader.close;
  }, [reader, name]);
  const context = { enabled, integrated, always, pick, settled, contentReady };
  useEffect(() => {
    reader.update(context);
  });
  const work = ytArtistOpening(state, { ...context, name, now: openedAt });
  const needsFinder = work.finder && online();
  const loadedFind = useLoadedLibraryFinder(needsFinder);
  return {
    state,
    enabled,
    openedAt,
    show: reader.retry,
    select: reader.pick,
    find: needsFinder ? loadedFind : null,
  };
};

/** A downloaded row prefers this artist's sorted songs over the shared online snapshot. */
export const useArtistSongsFinder = (
  songs: readonly SongRow[],
  shared: FindInLibrary | null,
): FindInLibrary | null =>
  useMemo(() => {
    if (shared === null) return null;
    const own = libraryFinderForRows(songs);
    return (song) => own(song) ?? shared(song);
  }, [songs, shared]);
