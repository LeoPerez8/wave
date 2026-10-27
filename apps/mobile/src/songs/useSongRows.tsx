import {
  songRowSwipeDirections,
  streamedArtistLink,
  ytDownloadStatus,
  type QueueContext,
  type RowMenuAction,
  type RowSwipeActions,
  type RowSwipeSide,
} from "@wave/core";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import type { AccessibilityActionInfo } from "react-native";

import { useFavoriteIds, usePendingFavoriteVideos } from "@/library/favorites";
import { useCurrentPath } from "@/library/routes";
import type { MenuOptions } from "@/playback/ActionsMenu";
import { useCurrentPlayingIds } from "@/playback/hooks";
import { unavailableStreamedVideos } from "@/playback/PlayHistory";
import { lyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";
import { useSwipeSettings } from "@/settings/swipeActions";
import { ytMusicEnabled, useYtMusicEnabled } from "@/settings/ytMusic";
import { knownLibraryFinder } from "@/ytmusic/libraryFinder";
import { ytAlbumPageHere } from "@/ytmusic/routes";
import { streamedArtistContextNow } from "@/ytmusic/streamedArtist";
import { useSongListDownloads } from "@/ytmusic/YtDownloads";
import type { NativeYtSong } from "@/native/waveYtMusic";

import { SongRow } from "./SongRow";
import { createSongListModel, type SongRowPresentation } from "./songListModel";
import type { SongListEntry } from "./songListSources";
import { songRowState, type SongListSnapshot } from "./songRowState";

export interface SongListSelection<T> {
  readonly selecting: boolean;
  readonly isChecked: (item: T) => boolean;
  readonly toggle: (item: T) => void;
  readonly start: (item: T) => void;
  /** Rows that can't be checked (a playlist's unavailable entry) do nothing while selecting. */
  readonly checkable?: ((item: T) => boolean) | undefined;
}

/** What a list of songs, or a capped preview of them, tells its rows. */
export interface SongRowsOptions<T> {
  readonly data: readonly T[];
  readonly keyExtractor: (item: T, index: number) => string;
  /** Null delegates a typed non-song slot to the list's renderSlot. */
  readonly song: (item: T) => SongListEntry | null;
  readonly context: QueueContext;
  readonly onPlay: (item: T, context: QueueContext) => void;
  readonly onMenu: (item: T, options: MenuOptions) => void;
  readonly onSongSwipe?: ((item: T, side: RowSwipeSide) => void) | undefined;
  /** A swipe to Remove from Playlist runs this instead, and the row slides out as it goes. */
  readonly onSongRemove?: ((item: T) => void) | undefined;
  readonly selection?: SongListSelection<T> | undefined;
  /** Screen-reader actions besides the swipes' (Move up / Move down in a playlist). */
  readonly rowActions?:
    ((item: T, index: number) => readonly AccessibilityActionInfo[]) | undefined;
  readonly onRowAction?: ((item: T, name: string) => void) | undefined;
  /** Wraps a row (drag furniture); memoize the wrapper, as the row element is kept while unchanged. */
  readonly decorateRow?: ((row: ReactElement, item: T, index: number) => ReactNode) | undefined;
}

const NO_SWIPE: RowSwipeActions = { right: null, left: null };
const ignore = (): void => undefined;
const NO_ACTIONS: readonly AccessibilityActionInfo[] = [];
/** Rows kept in the element cache: about four screens. */
const ELEMENTS = 256;

interface Kept {
  readonly shown: SongRowPresentation;
  readonly right: RowMenuAction | null;
  readonly left: RowMenuAction | null;
  readonly extras: readonly AccessibilityActionInfo[];
  readonly removes: boolean;
  readonly element: ReactElement;
}

/**
 * The rows of one list. It follows the playing ids, the stars, the downloads,
 * the swipe settings, the route, YT Music and the streams that refused to
 * play, once for all its rows; each row gets primitives and stable keyed
 * handlers. A row whose inputs didn't change keeps its element, so React
 * skips it (and a memoized `decorateRow` wrapper) entirely.
 */
export function useSongRows<T>({
  data,
  keyExtractor,
  song,
  context,
  onPlay,
  onMenu,
  onSongSwipe,
  onSongRemove,
  selection,
  rowActions,
  onRowAction,
  decorateRow,
}: SongRowsOptions<T>) {
  const currentIds = useCurrentPlayingIds();
  const favorites = useFavoriteIds();
  const pending = usePendingFavoriteVideos();
  const downloads = useSongListDownloads();
  const settings = useSwipeSettings();
  const here = useCurrentPath(false);
  const ytMusic = useYtMusicEnabled();
  const unplayable = useSyncExternalStore(
    unavailableStreamedVideos.subscribe,
    unavailableStreamedVideos.get,
  );
  const [model] = useState(createSongListModel);
  const [elements] = useState(() => new Map<string, Kept>());
  const [interned] = useState(() => new Map<string, readonly AccessibilityActionInfo[]>());
  const items = useMemo(
    () => new Map(data.map((item, index) => [keyExtractor(item, index), item])),
    [data, keyExtractor],
  );
  const snapshot = useMemo(
    (): SongListSnapshot => ({
      playing: currentIds,
      favorites,
      pending,
      download: (job) => ytDownloadStatus(downloads, job),
      ytMusic,
      unplayable,
    }),
    [currentIds, favorites, pending, downloads, ytMusic, unplayable],
  );
  const latest = useRef({
    items,
    song,
    context,
    onPlay,
    onMenu,
    onSongSwipe,
    onSongRemove,
    selection,
    onRowAction,
  });
  useLayoutEffect(() => {
    latest.current = {
      items,
      song,
      context,
      onPlay,
      onMenu,
      onSongSwipe,
      onSongRemove,
      selection,
      onRowAction,
    };
  });
  const press = useCallback((key: string) => {
    const current = latest.current;
    const item = current.items.get(key);
    if (item === undefined) return;
    if (current.selection?.selecting) {
      if (current.selection.checkable?.(item) !== false) current.selection.toggle(item);
      return;
    }
    const entry = current.song(item);
    // A ranked stream that can't play now does nothing (it reads the stores as they are now).
    if (
      entry?.gated === true &&
      entry.source.kind === "ytMusic" &&
      (!ytMusicEnabled() || unavailableStreamedVideos.get().has(entry.source.song.videoId))
    )
      return;
    current.onPlay(item, current.context);
  }, []);
  const menu = useCallback((key: string) => {
    const current = latest.current;
    const item = current.items.get(key);
    if (item === undefined || current.selection?.selecting) return;
    current.onMenu(
      item,
      current.selection === undefined ? {} : { onSelect: () => current.selection?.start(item) },
    );
  }, []);
  const swipe = useCallback((key: string, side: RowSwipeSide, action: RowMenuAction) => {
    const current = latest.current;
    const item = current.items.get(key);
    if (item === undefined || current.selection?.selecting) return;
    if (action === "removeFromPlaylist" && current.onSongRemove !== undefined)
      current.onSongRemove(item);
    else current.onSongSwipe?.(item, side);
  }, []);
  const extra = useCallback((key: string, name: string) => {
    const current = latest.current;
    const item = current.items.get(key);
    if (item !== undefined) current.onRowAction?.(item, name);
  }, []);

  const directionsOf = useCallback(
    (entry: SongListEntry, starred: boolean, state: ReturnType<typeof songRowState>["state"]) => {
      const { source } = entry;
      if (source.kind === "ytMusic")
        return songRowSwipeDirections(
          {
            kind: "ytMusic",
            options: {
              favorite: starred,
              album: (source.song as NativeYtSong).albumId,
              ytAlbumHere: ytAlbumPageHere(here),
              ytMusic,
              inPlaylist: entry.facts?.inPlaylist === true,
            },
            download: state.download,
            inLibrary: knownLibraryFinder() === null || knownLibraryFinder()?.(source.song) != null,
            artists: streamedArtistLink(source.song.artists ?? [], streamedArtistContextNow()),
          },
          settings,
        );
      if (source.kind === "unavailable")
        return songRowSwipeDirections({ kind: "unavailable" }, settings);
      if (entry.facts === undefined) return NO_SWIPE;
      return songRowSwipeDirections(
        {
          kind: "track",
          item: { ...entry.facts, favorite: starred, download: state.download },
          here,
          onlineLookups: lyricsAndGenreLookupsEnabled(),
        },
        settings,
      );
    },
    [here, ytMusic, settings],
  );

  /** What [item]'s row shows, or null for a non-song slot. */
  const shownOf = useCallback(
    (item: T, index: number) => {
      const entry = song(item);
      if (entry === null) return null;
      const key = keyExtractor(item, index);
      const checkable = selection?.checkable?.(item) !== false;
      const { state } = songRowState(
        entry,
        key,
        snapshot,
        selection?.selecting && checkable
          ? selection.isChecked(item)
            ? "checked"
            : "unchecked"
          : "off",
      );
      return { entry, key, state, shown: model.row(entry.source, state, key) };
    },
    [song, keyExtractor, selection, snapshot, model],
  );

  /** The song row for [item], or null for a non-song slot. */
  const render = useCallback(
    (item: T, index: number): ReactNode | null => {
      const row = shownOf(item, index);
      if (row === null) return null;
      const { entry, key, state, shown } = row;
      const directions =
        onSongSwipe === undefined || selection?.selecting || shown.disabled
          ? NO_SWIPE
          : directionsOf(entry, state.starred === true, state);
      const listed = rowActions?.(item, index) ?? NO_ACTIONS;
      const names = listed.map((action) => `${action.name}:${action.label ?? ""}`).join("|");
      const extras = names === "" ? NO_ACTIONS : (interned.get(names) ?? listed);
      if (names !== "" && !interned.has(names)) interned.set(names, listed);
      const removes = onSongRemove !== undefined;
      const kept = elements.get(key);
      let element: ReactElement;
      if (
        kept !== undefined &&
        kept.shown === shown &&
        kept.right === directions.right &&
        kept.left === directions.left &&
        kept.extras === extras &&
        kept.removes === removes
      )
        element = kept.element;
      else {
        element = (
          <SongRow
            {...shown}
            onPress={press}
            onLongPress={menu}
            onSwipe={swipe}
            swipeRight={directions.right}
            swipeLeft={directions.left}
            removes={removes}
            extraActions={extras}
            onExtraAction={extra}
          />
        );
        elements.delete(key);
        elements.set(key, {
          shown,
          right: directions.right,
          left: directions.left,
          extras,
          removes,
          element,
        });
        if (elements.size > ELEMENTS) elements.delete(elements.keys().next().value!);
      }
      return decorateRow === undefined ? element : decorateRow(element, item, index);
    },
    [
      shownOf,
      selection,
      onSongSwipe,
      onSongRemove,
      directionsOf,
      rowActions,
      interned,
      elements,
      press,
      menu,
      swipe,
      extra,
      decorateRow,
    ],
  );

  /** Changes whenever a row may render differently: the list's extraData. */
  const state = useMemo(
    () => ({ snapshot, selection, settings, here }),
    [snapshot, selection, settings, here],
  );
  /**
   * The row of the item keyed [key] as it shows, without its actions or
   * swipes: the copy a drag lifts over the list, with [accessory] (its grip).
   */
  const still = useCallback(
    (key: string, accessory?: ReactNode): ReactNode | null => {
      const item = items.get(key);
      if (item === undefined) return null;
      const row = shownOf(item, data.indexOf(item));
      return row === null ? null : (
        <SongRow {...row.shown} onPress={ignore} accessory={accessory} />
      );
    },
    [items, data, shownOf],
  );
  return { render, still, model, state };
}
