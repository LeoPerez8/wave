import { useScreenContent } from "@/lib/screenTiming";

import {
  artistLink,
  ytAlbumSongCount,
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

import { artworkUri } from "@/catalog/artworkUri";
import { Artwork } from "@/catalog/Artwork";

import { CELL, grid } from "@/catalog/grid";
import { PlayShuffle, type LineToggle } from "@/catalog/PlayShuffle";
import { TrackSkeletons } from "@/catalog/Skeletons";

import { Press } from "@/motion/Press";
import { playPage, playSongs } from "@/playback/actions";

import { followArtistLink } from "@/library/ArtistChoice";
import { DetailFrame } from "@/library/DetailFrame";

import { useAlbum, useLinkRows } from "@/library/hooks";
import type { AlbumRow, AlbumTrackRow, SongRow } from "@/library/LibraryStore";
import { parseId, useKnownRow, useOpenedIntegrated } from "@/library/routes";
import { songCount } from "@/library/TrackList";
import { useVisitState } from "@/lib/useVisitState";
import { usePlayPage } from "@/playback/hooks";
import { useChromeInset } from "@/chrome/chrome";
import { SongList } from "@/songs/SongList";
import { librarySongEntry, type SongListEntry } from "@/songs/songListSources";
import {
  mixedSongEntry,
  openMixedSongActions,
  runMixedSongSwipe,
  songSelection,
  type ListedSong,
} from "@/songs/mixedSongs";
import { useListScrollable } from "@/motion/heldTouch";
import type { NativeYtSong } from "@/native/waveYtMusic";
import {
  listedTrackItem,
  trackItemKey,
  tracksTarget,
  type TrackItem,
} from "@/playback/actionTargets";

import { useListSelection } from "@/selection/useListSelection";
import { albumJoinedItems } from "@/ytmusic/albumOpening";
import { useYtAlbumSection } from "@/ytmusic/albumSection";
import { YtLookupFooter } from "@/ytmusic/YtLookupFooter";
import { listDownloadAction, useYtAlbumDownloadButton } from "@/ytmusic/YtSongList";

type Entry = YtAlbumEntry<NativeYtSong, SongRow>;

type Item =
  | { readonly type: "disc"; readonly disc: number }
  | { readonly type: "track"; readonly track: AlbumTrackRow; readonly index: number }
  /** With YouTube Music's songs joined in: a Library song or a streamed one, in the release's order. */
  | { readonly type: "entry"; readonly entry: Entry; readonly index: number };

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

/** A track or a joined entry as the mixed song it is; a disc head is none. */
const listedOf = (item: Item): ListedSong | null =>
  item.type === "disc"
    ? null
    : item.type === "track"
      ? { source: "library", track: item.track }
      : item.entry;
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

/** The quiet line under the tracks about the album online: an outcome (loading shows skeleton rows). */
const YT_NOTE: Readonly<Record<Exclude<YtLibraryAlbumNote, "loading">, string>> = {
  notFound: "Not found online.",
  offline: "You're offline. Tap Online to try again when you're back online.",
  failed: "No answer online. Tap Online to try again.",
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
  toggle,
  songs: songTotal,
}: {
  shown: Shown;
  /** With YouTube Music's songs joined in, Play and Shuffle play them too. */
  mixed: readonly MixedSong<YtSong, SongRow>[] | null;
  /** The album's release on YouTube Music, once read: Download beside Play and Shuffle. */
  ytSongs: readonly NativeYtSong[];
  /** The Library | Online toggle ending the Play and Shuffle line, YT Music on. */
  toggle: LineToggle | null;
  /** How many songs the page lists: with YouTube Music's joined in, the whole tracklist. */
  songs: number;
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
    songCount(songTotal),
    `${Math.max(1, Math.round(album.durationMs / 60_000))} min`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <View style={{ gap: CELL * 2, paddingBottom: CELL }}>
      <Artwork uri={artworkUri(album, "original")} size={width - grid.margin * 2} />
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
        toggle={toggle}
      />
    </View>
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
  const [layoutTracks, keepLayout] = useVisitState<readonly AlbumTrackRow[] | null>(
    null,
    String(shown.album.id),
  );
  useEffect(() => {
    if (layoutTracks === null && shown.tracks !== undefined) keepLayout(shown.tracks);
  }, [layoutTracks, shown.tracks, keepLayout]);
  const yt = useYtAlbumSection(
    artist?.name ?? "",
    artist?.id ?? 0,
    shown.album,
    tracks,
    openedIntegrated,
    keepTracklist,
    shown.tracks !== undefined && artist !== null,
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
  const items = useMemo<readonly Item[]>(
    () =>
      entries === null ? albumItems(tracks) : albumJoinedItems(layoutTracks ?? tracks, entries),
    [entries, tracks, layoutTracks],
  );
  const context = useMemo(
    () => ({ kind: "album", id: String(shown.album.id) }) as const,
    [shown.album.id],
  );

  const source = useCallback((item: Item): SongListEntry => {
    if (item.type === "disc")
      return { source: { kind: "discHeader", key: itemKey(item), label: `Disc ${item.disc}` } };
    if (item.type === "track")
      return librarySongEntry(item.track, {
        leading: { kind: "trackNumber", number: item.track.trackNumber ?? undefined },
      });
    return mixedSongEntry(item.entry, {
      leading: { kind: "trackNumber", number: item.entry.number ?? undefined },
    });
  }, []);
  const rowSelection = useMemo(
    () =>
      songSelection(listSelection, (item: Item) => {
        const song = listedOf(item);
        return song === null ? null : listedTrackItem(song);
      }),
    [listSelection],
  );

  return (
    <SongList
      scrollEnabled={scrollable}
      className="flex-1"
      data={items}
      keyExtractor={itemKey}
      song={source}
      context={context}
      selection={rowSelection}
      onPlay={(item) => {
        if (item.type === "track") playSongs(tracks, item.index, context);
        else if (item.type === "entry" && mixed !== null) void playPage(mixed, item.index, context);
      }}
      onMenu={(item, options) => {
        const song = listedOf(item);
        if (song !== null) openMixedSongActions(song, options);
      }}
      onSongSwipe={(item, shown) => {
        const song = listedOf(item);
        if (song !== null) runMixedSongSwipe(song, shown);
      }}
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
      ListHeaderComponent={
        <AlbumHead
          shown={shown}
          mixed={mixed}
          ytSongs={ytView?.songs ?? NO_SONGS}
          toggle={ytView === null ? null : yt.toggle}
          songs={ytAlbumSongCount(shown.album.trackCount, ytView)}
        />
      }
      ListFooterComponent={
        // Until the combined tracklist arrives, skeleton rows follow the Library's tracks.
        ytView === null ? null : ytView.note === "loading" ? (
          <TrackSkeletons leading="number" />
        ) : (
          <YtLookupFooter note={ytView.note === null ? null : YT_NOTE[ytView.note]} />
        )
      }
    />
  );
}

/**
 * An album: large cover, title, album artist, furniture, Play / Shuffle,
 * tracks by disc and number. Opened from a list that knows the album, the
 * header is there on the first frame and the tracks follow once read. While
 * YT Music is on a Library | Online toggle ends the Play and Shuffle line;
 * opened from an integrated view (`openAlbum`'s `integrated`) it opens with
 * Online selected. With Online, the album's songs on YouTube Music that the
 * Library lacks join the tracks, streamed; Library shows the album as it is again.
 */
export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const albumId = parseId(id);
  const detail = useAlbum(albumId);
  useScreenContent(detail !== undefined);
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
