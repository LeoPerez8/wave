import type { LegendListRef } from "@legendapp/list/react-native";
import {
  IconCircleCheck,
  IconCloudOff,
  IconDownload,
  IconRefresh,
  IconWifiOff,
  IconX,
} from "@tabler/icons-react-native";
import {
  YT_ALBUM_DOWNLOAD_ACTION_LABELS,
  YT_DOWNLOAD_BUTTON_LABELS,
  YT_PLAYLIST_DOWNLOAD_ACTION_LABELS,
  discoverSongs,
  discoverTrackId,
  joinArtists,
  ytAlbumDownloadButton,
  ytAlbumSongs,
  ytPlaylistDownloadButton,
  ytPlaylistRestLine,
  type MixedSong,
  type PlaylistItem,
  type QueueContext,
  type YtListDownloadButtonState,
  type YtPlaylistRest,
  type YtQuietReason,
} from "@wave/core";
import type { DownloadOrigin } from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CELL, grid } from "@/catalog/grid";
import { PlayShuffle, type LastListAction } from "@/catalog/PlayShuffle";
import {
  HiddenSkeletonBox,
  HiddenSkeletonLine,
  PlayShuffleSkeleton,
  TrackSkeletons,
} from "@/catalog/Skeletons";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextButton } from "@/components/TextButton";
import {
  entryText,
  FIND_FIELD_HEIGHT,
  FindHead,
  useFindInLegendList,
} from "@/library/FindInPlaylist";
import type { SongRow } from "@/library/LibraryStore";
import { songCount } from "@/library/TrackList";
import { useListScrollable } from "@/motion/heldTouch";
import { useScreenSettled } from "@/lib/screenTiming";
import { online } from "@/native/waveNative";
import type { NativeYtPlaylist, NativeYtSong } from "@/native/waveYtMusic";
import { showToast } from "@/overlay/toast";
import { playDiscoverSongs } from "@/playback/actions";
import { listedTrackItem, trackItemKey, tracksTarget } from "@/playback/actionTargets";
import { useListSelection } from "@/selection/useListSelection";
import {
  mixedSongEntry,
  openMixedSongActions,
  runMixedSongSwipe,
  songSelection,
} from "@/songs/mixedSongs";
import { SongList } from "@/songs/SongList";
import { occurrenceKeys } from "@/songs/songRowState";

import { artistOpeningRequest } from "./artistOpeningRequest";
import { askYtMusic } from "./askYtMusic";
import { useLibraryFinder, useLoadedInLibrary, useLoadedLibraryFinder } from "./libraryFinder";
import type { YtListHead, YtListScreen } from "./routes";
import {
  runYtDownloadAction,
  runYtPlaylistDownloadAction,
  useYtAlbumDownload,
  useYtPlaylistDownload,
  type YtListDownloadAction,
} from "./YtDownloads";
import type { YtMusic, YtMusicError } from "./YtMusic";

const NO_SONGS: readonly NativeYtSong[] = [];

/** A YT Music album or playlist page as its screen shows it. */
export interface YtListPage {
  readonly head: YtListHead;
  /** "Album · 2013", "Playlist": what the page is, before its count and length. */
  readonly kind: string;
  readonly songs: readonly NativeYtSong[];
  /**
   * The list as it shows and plays, when it isn't [songs] alone: a Discover
   * mix's Library songs among its new ones. [songs] are still what downloads.
   */
  readonly listed?: readonly Song[];
}

/**
 * A page being read: loading, then the page or why it couldn't be read. A
 * playlist shows its songs as its pages come in ([rest]: more coming, all in,
 * or why the rest didn't load); an album comes whole.
 */
export type YtListLoad =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly page: YtListPage; readonly rest: YtPlaylistRest }
  | { readonly status: "quiet"; readonly reason: YtQuietReason };

const LOADING: YtListLoad = { status: "loading" };

const playlistPage = (playlist: NativeYtPlaylist): YtListPage => ({
  head: { title: playlist.title, line: playlist.author ?? "", artworkUrl: playlist.artworkUrl },
  kind: "Playlist",
  songs: playlist.songs,
});

/**
 * Reads the page [id] of [screen]: an album's (its songs on it, with its
 * cover) or a playlist's, whose pages [onPage] hears as they come.
 */
const readPage =
  (
    screen: YtListScreen,
    id: string,
    onPage: (page: YtListPage, done: boolean) => void,
    signal: AbortSignal,
  ) =>
  (ytMusic: YtMusic["Service"]): Effect.Effect<YtListPage, YtMusicError> =>
    screen === "yt-album"
      ? ytMusic.album(id).pipe(
          Effect.map((album) => ({
            head: {
              title: album.title,
              line: joinArtists(album.artists),
              artworkUrl: album.artworkUrl,
            },
            kind: album.year === null ? "Album" : `Album · ${album.year}`,
            songs: ytAlbumSongs(id, album),
          })),
        )
      : ytMusic
          .playlist(id, {
            onPage: (playlist, done) => onPage(playlistPage(playlist), done),
            signal,
          })
          .pipe(Effect.map(playlistPage));

/**
 * Reads a YT Music album or playlist page for the screen showing it. A
 * playlist shows from its first page on; when a later page fails, the songs
 * already shown stay and `rest` says why the others didn't come.
 */
export const useYtListPage = (screen: YtListScreen, id: string) => {
  const settled = useScreenSettled();
  const connected = online();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const key = `${screen}/${id}/${attempt}`;
  const [answer, setAnswer] = useState<{ readonly key: string; readonly load: YtListLoad } | null>(
    null,
  );
  useEffect(() => {
    if (!settled || !connected) return;
    let current = true;
    const cancel = new AbortController();
    const show = (load: YtListLoad) => {
      if (current) setAnswer({ key, load });
    };
    let shown: YtListPage | null = null;
    const onPage = (page: YtListPage, done: boolean) => {
      shown = page;
      show({ status: "loaded", page, rest: done ? "read" : "reading" });
    };
    void askYtMusic(
      (ytMusic) =>
        artistOpeningRequest(online, readPage(screen, id, onPage, cancel.signal)(ytMusic)),
      cancel.signal,
    ).then(
      (result) => {
        if (Result.isSuccess(result)) {
          // A playlist's last page has been shown already.
          if (shown === null) show({ status: "loaded", page: result.success, rest: "read" });
          return;
        }
        const reason = result.failure.reason === "offline" ? "offline" : "failed";
        show(
          shown === null
            ? { status: "quiet", reason }
            : { status: "loaded", page: shown, rest: reason },
        );
      },
      () => {
        if (current) show({ status: "quiet", reason: "failed" });
      },
    );
    return () => {
      current = false;
      cancel.abort();
    };
  }, [screen, id, key, settled, connected]);
  const load: YtListLoad =
    answer?.key === key
      ? answer.load
      : connected
        ? LOADING
        : { status: "quiet", reason: "offline" };
  return { load, retry };
};

type Song = MixedSong<NativeYtSong, SongRow>;

const totalMinutes = (songs: readonly Song[]): string | null => {
  const ms = songs.reduce(
    (total, song) =>
      total + ((song.source === "library" ? song.track.durationMs : song.song.durationMs) ?? 0),
    0,
  );
  return ms === 0 ? null : `${Math.max(1, Math.round(ms / 60_000))} min`;
};

/** What a list's download button can show: an entry to act on, or that every song is downloaded. */
type YtListDownloadButtonAction = YtListDownloadAction | "downloaded";

/** Downloaded has a check of its own, so an icon-only button doesn't look like Download. */
const DOWNLOAD_ICONS: { readonly [A in YtListDownloadButtonAction]: typeof IconDownload } = {
  downloaded: IconCircleCheck,
  downloadAlbum: IconDownload,
  downloadPlaylist: IconDownload,
  retryFailed: IconRefresh,
  cancelAlbumDownload: IconX,
  cancelPlaylistDownload: IconX,
};

/**
 * An album's or a playlist's download button beside Play and Shuffle (Core's
 * `ytAlbumDownloadButton`, `ytPlaylistDownloadButton`).
 */
export interface YtListDownloadButton {
  readonly action: YtListDownloadButtonAction;
  readonly label: string;
  readonly onPress: () => void;
}

/** The full name of each download button, heard in either of its forms. */
const DOWNLOAD_NAMES: { readonly [A in YtListDownloadButtonAction]: string } = {
  ...YT_ALBUM_DOWNLOAD_ACTION_LABELS,
  ...YT_PLAYLIST_DOWNLOAD_ACTION_LABELS,
  downloaded: "Downloaded",
};

/** Tapping Downloaded only says so: it never removes a file. */
const sayDownloaded = (): void => void showToast("Downloaded");

/**
 * A page's download button from Core's [button]: an entry runs [run];
 * Downloaded only says so, and waits for the Library's first read ([loaded]),
 * before which every song counts as in it.
 */
const pageButton = <A extends YtListDownloadAction>(
  button: YtListDownloadButtonState<A> | null,
  loaded: boolean,
  run: (action: A) => void,
): YtListDownloadButton | null => {
  if (button === null) return null;
  const { action, label } = button;
  if (action === "downloaded") return loaded ? { action, label, onPress: sayDownloaded } : null;
  return { action, label, onPress: () => run(action) };
};

/** An album's or a playlist's download button, as the list action after Play and Shuffle. */
export const listDownloadAction = (download: YtListDownloadButton | null): LastListAction | null =>
  download === null
    ? null
    : {
        icon: DOWNLOAD_ICONS[download.action],
        label: download.label,
        labels: YT_DOWNLOAD_BUTTON_LABELS,
        accessibilityLabel: DOWNLOAD_NAMES[download.action],
        onPress: download.onPress,
      };

/**
 * Downloading the YT Music album whose songs are [songs] (none: no album):
 * its progress line ("Downloading · 3 of 10") and its button, or null. The
 * songs it queues remember [origin], the album or mix (Settings › Downloads
 * groups them by it).
 */
export const useYtAlbumDownloadButton = (
  songs: readonly NativeYtSong[],
  origin: DownloadOrigin | null,
): { readonly progress: string | null; readonly button: YtListDownloadButton | null } => {
  const settled = useScreenSettled();
  const active = settled && songs.length > 0;
  const inLibrary = useLoadedInLibrary(active);
  const loaded = useLoadedLibraryFinder(active) !== null;
  const download = useYtAlbumDownload(songs, inLibrary);
  const button = ytAlbumDownloadButton(download);
  return {
    progress: download.line,
    button:
      songs.length === 0
        ? null
        : pageButton(button, loaded, (action) =>
            runYtDownloadAction(action, songs, inLibrary, origin),
          ),
  };
};

/**
 * Downloading a playlist's YT Music and unsearched entries, the playlist holding [entries]:
 * its progress line ("Downloading · 3 of 10") and its button, or null. The songs it queues
 * remember [origin], the playlist.
 */
export const useYtPlaylistDownloadButton = (
  entries: readonly PlaylistItem<NativeYtSong, { readonly path: string | null }>[],
  origin: DownloadOrigin | null,
): { readonly progress: string | null; readonly button: YtListDownloadButton | null } => {
  const inLibrary = useLoadedInLibrary();
  const loaded = useLoadedLibraryFinder() !== null;
  const download = useYtPlaylistDownload(entries, inLibrary);
  const button = ytPlaylistDownloadButton(download);
  return {
    progress: download.line,
    button: pageButton(button, loaded, (action) =>
      runYtPlaylistDownloadAction(action, entries, inLibrary, origin),
    ),
  };
};

/**
 * The page's head: cover, title, maker, furniture, Play / Shuffle. While the
 * page loads ([loading]) it keeps what the tapped cover knew ([head]; a
 * still cover and title line when nothing is known), with a skeleton detail
 * line and Play / Shuffle.
 */
function Head({
  head,
  loading,
  furniture,
  progress,
  onPlay,
  download,
}: {
  head: YtListHead | undefined;
  loading: boolean;
  furniture: string | null;
  /** An album's download progress ("Downloading · 3 of 10"). */
  progress: string | null;
  onPlay: ((shuffle: boolean) => void) | null;
  /** The album's download button (Core's `ytAlbumDownloadButton`). */
  download: YtListDownloadButton | null;
}) {
  const { width } = useWindowDimensions();
  const cover = width - grid.margin * 2;
  return (
    <View style={{ gap: CELL * 2, paddingBottom: CELL }}>
      {head === undefined ? (
        <HiddenSkeletonBox width={cover} height={cover} />
      ) : (
        <Artwork uri={head.artworkUrl ?? undefined} size={cover} />
      )}
      <View style={{ gap: CELL / 2 }}>
        {head === undefined ? (
          <HiddenSkeletonLine lineHeight={34} width="70%" />
        ) : (
          <Text
            accessibilityRole="header"
            className="font-sans text-title1 font-light text-foreground"
            style={{ letterSpacing: -0.4 }}
          >
            {head.title}
          </Text>
        )}
        {head !== undefined && head.line !== "" && (
          <Text className="font-sans text-body font-medium text-secondary">{head.line}</Text>
        )}
        {loading && <HiddenSkeletonLine lineHeight={18} width="40%" />}
        {furniture !== null && (
          <Text
            className="font-sans text-footnote text-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {furniture}
          </Text>
        )}
        {progress !== null && (
          <Text
            className="font-sans text-footnote text-accent"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {progress}
          </Text>
        )}
      </View>
      {loading ? (
        <PlayShuffleSkeleton />
      ) : (
        onPlay !== null && (
          <PlayShuffle
            onPlay={() => onPlay(false)}
            onShuffle={() => onPlay(true)}
            last={listDownloadAction(download)}
          />
        )
      )}
    </View>
  );
}

/** Skeleton rows for a page's songs while it loads: enough to fill the screen under the head. */
const PAGE_SKELETON_ROWS = 6;

/**
 * A YT Music album, playlist or Discover mix: its cover, title, maker
 * and furniture, Play / Shuffle, then its songs. Songs the Library has play
 * its files; the rest stream. Offline, or when YouTube fails, a quiet empty
 * state takes the songs' place. While the page loads, still skeletons stand
 * for its detail line, Play / Shuffle and songs. A playlist's songs show page
 * by page, with skeleton rows under them while more come and a line when the
 * rest didn't load; Play, Shuffle and taps play the songs shown.
 */
export function YtSongList({
  known,
  load,
  context,
  numbered,
  albumDownload,
  findable = false,
  onRetry,
}: {
  /** What the tapped cover knew, shown until the page arrives. */
  known: YtListHead | undefined;
  load: YtListLoad;
  context: QueueContext;
  /** An album's songs lead with their number; a playlist's with their cover. */
  numbered: boolean;
  /**
   * An album or a Discover mix downloads as a whole: Download beside Play and Shuffle, and its
   * progress. Its songs remember it, by [context]'s id and its title.
   */
  albumDownload?: "album" | "mix";
  /**
   * Find in Playlist (a playlist): its field waits above the head until the
   * list is pulled down, and narrows the songs read so far as you type; while
   * more pages come, their skeleton rows stay and "No songs match" waits for them.
   */
  findable?: boolean;
  /** Repeat the existing online page read after a failure. */
  onRetry?: () => void;
}) {
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const settled = useScreenSettled();
  const find = useLibraryFinder(settled && load.status === "loaded");
  const page = load.status === "loaded" ? load.page : null;
  const origin = useMemo(
    (): DownloadOrigin | null =>
      albumDownload === undefined || page === null || context.id === null
        ? null
        : { kind: albumDownload, id: context.id, name: page.head.title },
    [albumDownload, page, context.id],
  );
  const download = useYtAlbumDownloadButton(
    albumDownload !== undefined && page !== null ? page.songs : NO_SONGS,
    origin,
  );
  const songs = useMemo(
    (): readonly Song[] => (page === null ? [] : (page.listed ?? discoverSongs(page.songs, find))),
    [page, find],
  );
  const selectable = useMemo(() => songs.map(listedTrackItem), [songs]);
  const selection = useListSelection({
    items: selectable,
    keyOf: trackItemKey,
    target: tracksTarget,
  });
  const play = useCallback(
    (startIndex: number | undefined, shuffle = false) =>
      void playDiscoverSongs(songs, startIndex, context, { shuffle }),
    [songs, context],
  );
  const list = useRef<LegendListRef>(null);
  const findInList = useFindInLegendList(list, songs, entryText, findable);
  const { shown } = findInList;
  // Rows key by song, a real duplicate by its occurrence: a playlist filling in keeps its keys.
  const keys = useMemo(() => occurrenceKeys(songs, discoverTrackId), [songs]);
  const keyOf = useCallback((song: Song) => keys.get(song) ?? discoverTrackId(song), [keys]);
  const places = useMemo(() => new Map(songs.map((song, index) => [song, index])), [songs]);
  const source = useCallback(
    (song: Song) =>
      mixedSongEntry(
        song,
        numbered
          ? { leading: { kind: "trackNumber", number: (places.get(song) ?? 0) + 1 } }
          : undefined,
      ),
    [numbered, places],
  );
  const rowSelection = useMemo(() => songSelection(selection, listedTrackItem), [selection]);
  const head = page?.head ?? known;
  const loading = load.status === "loading";
  // More of a playlist's pages on their way.
  const reading = load.status === "loaded" && load.rest === "reading";
  const restLine = load.status === "loaded" ? ytPlaylistRestLine(load.rest) : null;
  const furniture =
    page === null
      ? null
      : [page.kind, songCount(songs.length), totalMinutes(songs)]
          .filter((part) => part !== null)
          .join(" · ");

  const pageHead = (
    <>
      {(head !== undefined || loading) && (
        <Head
          head={head}
          loading={loading}
          furniture={furniture}
          progress={download.progress}
          onPlay={songs.length === 0 ? null : (shuffle) => play(undefined, shuffle)}
          download={download.button}
        />
      )}
      {load.status === "quiet" && (
        <>
          <EmptyState
            icon={load.reason === "offline" ? IconWifiOff : IconCloudOff}
            title={load.reason === "offline" ? "You're offline" : "No answer online"}
            message={
              load.reason === "offline"
                ? "These songs need the network."
                : "The songs couldn't be loaded. Try again."
            }
          />
          {onRetry !== undefined && <TextButton label="Try Again" onPress={onRetry} />}
        </>
      )}
    </>
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader />
      <SongList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEnabled={scrollable}
        ref={list}
        className="flex-1"
        data={shown}
        keyExtractor={keyOf}
        song={source}
        context={context}
        selection={rowSelection}
        // A found song plays the whole playlist from its own place in it.
        onPlay={(song) => play(places.get(song))}
        onMenu={openMixedSongActions}
        onSongSwipe={(song, side) => runMixedSongSwipe(song, side)}
        contentContainerStyle={{
          paddingHorizontal: grid.margin,
          paddingBottom: bottomInset,
          minHeight: findable ? findInList.minHeight : undefined,
        }}
        initialScrollOffset={findable ? FIND_FIELD_HEIGHT : undefined}
        ListHeaderComponent={
          findable ? (
            // Pages still on their way may hold matches: no "No songs match" until they're all in.
            <FindHead find={findInList} header={pageHead} allRead={!reading} />
          ) : (
            pageHead
          )
        }
        ListFooterComponent={
          loading ? (
            <TrackSkeletons count={PAGE_SKELETON_ROWS} leading={numbered ? "number" : "artwork"} />
          ) : reading ? (
            // More pages coming: skeleton rows at the list's end, where their songs will go.
            <TrackSkeletons leading={numbered ? "number" : "artwork"} />
          ) : (
            <RestLine line={restLine} />
          )
        }
      />
    </View>
  );
}

/** Under a playlist's songs when the rest couldn't be read. */
function RestLine({ line }: { line: string | null }) {
  if (line === null) return null;
  return (
    <View className="justify-center" style={{ minHeight: CELL * 6, paddingTop: CELL * 2 }}>
      <Text className="font-sans text-footnote text-secondary">{line}</Text>
    </View>
  );
}
