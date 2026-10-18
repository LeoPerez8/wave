import { LegendList } from "@legendapp/list/react-native";
import {
  artistLink,
  discoverTrackId,
  ytTrackId,
  type MixedSong,
  type YtAlbumEntry,
  type YtLibraryAlbumNote,
  type YtSong,
  albumDownloadOrigin,
} from "@wave/core";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { PlayShuffle } from "@/catalog/PlayShuffle";
import { TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { Press } from "@/motion/Press";
import { playPage, playSongs } from "@/playback/actions";
import { useCurrentTrackId, usePlayPage } from "@/playback/hooks";
import { openTrackActions } from "@/playback/ActionsMenu";
import { followArtistLink } from "@/library/ArtistChoice";
import { DetailFrame } from "@/library/DetailFrame";
import { useFavoriteIds } from "@/library/favorites";
import { useAlbum, useLinkRows } from "@/library/hooks";
import type { AlbumRow, AlbumTrackRow, SongRow } from "@/library/LibraryStore";
import { parseId, useKnownRow, useOpenedIntegrated } from "@/library/routes";
import { songCount, toTrackSummary } from "@/library/TrackList";
import { useVisitState } from "@/lib/useVisitState";
import { useListScrollable } from "@/motion/heldTouch";
import type { NativeYtSong } from "@/native/waveYtMusic";
import {
  listedTrackItem,
  trackItemKey,
  tracksTarget,
  type TrackItem,
} from "@/playback/actionTargets";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection, type ListSelection } from "@/selection/useListSelection";
import { useYtAlbumSection } from "@/ytmusic/albumSection";
import { YtLookupFooter } from "@/ytmusic/YtLookupFooter";
import { listDownloadAction, useYtAlbumDownloadButton } from "@/ytmusic/YtSongList";
import { YtSongRow } from "@/ytmusic/YtSongRow";
import { openYtSongActions } from "@/ytmusic/YtSongActions";

type Entry = YtAlbumEntry<NativeYtSong, SongRow>;

type Item =
  | { readonly type: "disc"; readonly disc: number }
  | { readonly type: "track"; readonly track: AlbumTrackRow; readonly index: number }
  /** With YouTube Music's songs joined in: a Library song or a streamed one, in the release's order. */
  | { readonly type: "entry"; readonly entry: Entry; readonly index: number };

const DISC_HEAD = CELL * 6;

/** Tracks in album order, with a "Disc n" head before each disc when there is more than one. */
const albumItems = (tracks: readonly AlbumTrackRow[]): Item[] => {
  const discs = new Set(tracks.map((track) => track.discNumber ?? 1));
  const items: Item[] = [];
  let disc: number | null = null;
  tracks.forEach((track, index) => {
    const current = track.discNumber ?? 1;
    if (discs.size > 1 && current !== disc) items.push({ type: "disc", disc: current });
    disc = current;
    items.push({ type: "track", track, index });
  });
  return items;
};

/** What the screen shows: the album, and its tracks (and genre) once they are read. */
interface Shown {
  readonly album: AlbumRow;
  readonly genre: string | null;
  /** Undefined until the tracks are read; the header doesn't wait for them. */
  readonly tracks: readonly AlbumTrackRow[] | undefined;
}

const NO_TRACKS: readonly AlbumTrackRow[] = [];
const NO_SONGS: readonly NativeYtSong[] = [];

const itemKey = (item: Item): string => {
  switch (item.type) {
    case "disc":
      return `disc-${item.disc}`;
    case "track":
      return String(item.track.id);
    case "entry":
      return item.entry.source === "library"
        ? String(item.entry.track.id)
        : ytTrackId(item.entry.song.videoId);
  }
};

const YT_NOTE: Readonly<Record<YtLibraryAlbumNote, string>> = {
  loading: "Looking on YouTube Music…",
  notFound: "Not found on YouTube Music.",
  offline: "You're offline. Try again when you're back online.",
  failed: "YouTube Music didn't answer. Try again in a moment.",
};

/** The entries as playback takes them: the Library's files, the rest streamed. */
const mixedSongs = (entries: readonly Entry[]): MixedSong<YtSong, SongRow>[] =>
  entries.map((entry) =>
    entry.source === "library"
      ? { source: "library", track: entry.track }
      : { source: "stream", song: entry.song },
  );

function AlbumHead({
  shown,
  mixed,
  ytSongs,
}: {
  shown: Shown;
  /** With YouTube Music's songs joined in, Play and Shuffle play them too. */
  mixed: readonly MixedSong<YtSong, SongRow>[] | null;
  /** The album's release on YouTube Music, once read: Download beside Play and Shuffle. */
  ytSongs: readonly NativeYtSong[];
}) {
  const { width } = useWindowDimensions();
  const { album, genre, tracks } = shown;
  const context = useMemo(() => ({ kind: "album", id: String(album.id) }) as const, [album.id]);
  // Its tracks, or with YouTube Music's songs joined in the whole list, by `playPage`'s rule.
  const songs = useMemo(
    () => mixed ?? tracks?.map((track) => ({ source: "library" as const, track })),
    [mixed, tracks],
  );
  const play = usePlayPage(songs, context);
  const origin = useMemo(
    () => albumDownloadOrigin({ id: album.id, title: album.title }),
    [album.id, album.title],
  );
  const download = useYtAlbumDownloadButton(ytSongs, origin);
  // Several album artists: the line opens Go to Artist's choice (Core's `artistLink`). The
  // head is on the album's page, where no artist is left out; it doesn't follow the route,
  // which would render it on every navigation while the album stays in a stack.
  const artistTo = artistLink(album.albumArtistIds, "");
  // Read ahead, so the artist's screen opens header-first.
  const { artist } = useLinkRows(
    undefined,
    artistTo?.kind === "open" ? artistTo.artistId : undefined,
  );
  // "Rock · 1997 · 12 songs · 52 min": the grid's furniture line, spelled out.
  const furniture = [
    genre,
    album.year,
    songCount(album.trackCount),
    `${Math.max(1, Math.round(album.durationMs / 60_000))} min`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <View style={{ gap: CELL * 2, paddingBottom: CELL }}>
      <Artwork
        uri={album.artworkPath === null ? undefined : `file://${album.artworkPath}`}
        size={width - grid.margin * 2}
      />
      <View style={{ gap: CELL / 2 }}>
        <Text
          accessibilityRole="header"
          className="font-sans text-title1 font-light text-foreground"
          style={{ letterSpacing: -0.4 }}
        >
          {album.title}
        </Text>
        <Press
          accessibilityRole="link"
          accessibilityLabel={`Go to ${album.albumArtist}`}
          onPress={() => artistTo !== undefined && followArtistLink(artistTo, artist)}
          haptic="selection"
          className="self-start justify-center"
          style={{ minHeight: 48 }}
        >
          <Text className="font-sans text-body font-medium text-accent">{album.albumArtist}</Text>
        </Press>
        <Text
          className="font-sans text-footnote text-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {furniture}
        </Text>
        {download.progress !== null && (
          <Text
            className="font-sans text-footnote text-accent"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {download.progress}
          </Text>
        )}
      </View>
      <PlayShuffle
        onPlay={() => play(false)}
        onShuffle={() => play(true)}
        last={listDownloadAction(download.button)}
      />
    </View>
  );
}

/**
 * A row of the album with YouTube Music's songs joined in: a Library song,
 * marked downloaded, or a streamed one with the YT Music song's menu.
 */
function EntryRow({
  entry,
  playing,
  favorite,
  listSelection,
  onPress,
}: {
  entry: Entry;
  playing: boolean;
  favorite: boolean;
  listSelection: ListSelection<TrackItem>;
  onPress: () => void;
}) {
  if (entry.source === "stream")
    return (
      <YtSongRow
        song={entry.song}
        trackNumber={entry.number}
        playing={playing}
        {...selectableRow({ ytSong: entry.song }, listSelection, onPress, (options) =>
          openYtSongActions(entry.song, options),
        )}
      />
    );
  return (
    <TrackRow
      track={{ ...toTrackSummary(entry.track), trackNumber: entry.number ?? undefined }}
      state={playing ? "playing" : undefined}
      favorite={favorite}
      leading="number"
      downloaded
      {...selectableRow({ song: entry.track }, listSelection, onPress, (options) =>
        openTrackActions(entry.track, options),
      )}
    />
  );
}

function AlbumTracks({ shown, openedIntegrated }: { shown: Shown; openedIntegrated: boolean }) {
  const tracks = shown.tracks ?? NO_TRACKS;
  // The album goes by its first album artist's YouTube Music answer.
  const { artist } = useLinkRows(
    undefined,
    shown.album.albumArtistIds[0] ?? shown.album.albumArtistId,
  );
  // Once the page shows the tracklist with YouTube Music's songs, it keeps it for the visit:
  // the last download finishing leaves every row where it was.
  const [keepTracklist, keep] = useVisitState(false);
  const yt = useYtAlbumSection(
    artist?.name ?? "",
    artist?.id ?? 0,
    shown.album,
    tracks,
    openedIntegrated,
    keepTracklist,
  );
  // Nothing is joined until the tracks and the artist are read.
  const ytView = shown.tracks === undefined || artist === null ? null : yt.view;
  const entries = ytView?.tracks ?? null;
  const joined = entries !== null;
  useEffect(() => {
    if (joined) keep(true);
  }, [joined, keep]);
  const mixed = useMemo(() => (entries === null ? null : mixedSongs(entries)), [entries]);
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  // Selection keys the tracks themselves (every disc), not the disc heads.
  const selectable = useMemo(
    (): TrackItem[] =>
      entries === null ? tracks.map((song) => ({ song })) : entries.map(listedTrackItem),
    [entries, tracks],
  );
  const listSelection = useListSelection({
    items: selectable,
    keyOf: trackItemKey,
    target: tracksTarget,
  });
  const rowState = useMemo(
    () => ({ currentId, favorites, selection: listSelection.selection }),
    [currentId, favorites, listSelection.selection],
  );
  const items = useMemo(
    () =>
      entries === null
        ? albumItems(tracks)
        : entries.map((entry, index): Item => ({ type: "entry", entry, index })),
    [entries, tracks],
  );
  const context = useMemo(
    () => ({ kind: "album", id: String(shown.album.id) }) as const,
    [shown.album.id],
  );

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      switch (item.type) {
        case "disc":
          return (
            <View className="justify-end" style={{ height: DISC_HEAD, paddingBottom: CELL }}>
              <CatalogLine>{`Disc ${item.disc}`}</CatalogLine>
            </View>
          );
        case "entry": {
          const song = mixed?.[item.index];
          return (
            <EntryRow
              entry={item.entry}
              playing={song !== undefined && discoverTrackId(song) === currentId}
              favorite={item.entry.source === "library" && favorites.has(item.entry.track.id)}
              listSelection={listSelection}
              onPress={() => mixed !== null && void playPage(mixed, item.index, context)}
            />
          );
        }
        case "track":
          return (
            <TrackRow
              track={{
                ...toTrackSummary(item.track),
                trackNumber: item.track.trackNumber ?? undefined,
              }}
              state={String(item.track.id) === currentId ? "playing" : undefined}
              favorite={favorites.has(item.track.id)}
              leading="number"
              {...selectableRow(
                { song: item.track },
                listSelection,
                () => playSongs(tracks, item.index, context),
                (options) => openTrackActions(item.track, options),
              )}
            />
          );
      }
    },
    [context, currentId, tracks, favorites, listSelection, mixed],
  );

  return (
    <LegendList
      scrollEnabled={scrollable}
      className="flex-1"
      data={items}
      keyExtractor={itemKey}
      renderItem={renderItem}
      extraData={rowState}
      getItemType={(item) => item.type}
      getFixedItemSize={(item) => (item.type === "disc" ? DISC_HEAD : grid.row)}
      estimatedItemSize={grid.row}
      recycleItems
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
      ListHeaderComponent={
        <AlbumHead shown={shown} mixed={mixed} ytSongs={ytView?.songs ?? NO_SONGS} />
      }
      ListFooterComponent={
        ytView === null ? null : (
          <YtLookupFooter
            note={ytView.note === null ? null : YT_NOTE[ytView.note]}
            button={ytView.button}
            onShow={yt.show}
          />
        )
      }
    />
  );
}

/**
 * An album: large cover, title, album artist, furniture, Play / Shuffle,
 * tracks by disc and number. Opened from a list that knows the album, the
 * header is there on the first frame and the tracks follow once read. While
 * YT Music is on it ends with Show on YouTube Music; opened from an
 * integrated view (`openAlbum`'s `integrated`), or once that's tapped, the
 * album's songs on YouTube Music that the Library lacks join the tracks,
 * streamed, and the Library's are marked downloaded.
 */
export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const albumId = parseId(id);
  const detail = useAlbum(albumId);
  const known = useKnownRow("album", albumId);
  const openedIntegrated = useOpenedIntegrated();
  const shown: Shown | null | undefined =
    detail === undefined && known !== undefined
      ? { album: known, genre: null, tracks: undefined }
      : detail;
  return (
    <DetailFrame detail={shown} noun="album">
      {(album) => <AlbumTracks shown={album} openedIntegrated={openedIntegrated} />}
    </DetailFrame>
  );
}
