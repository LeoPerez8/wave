import { LegendList } from "@legendapp/list/react-native";
import { IconCloudOff, IconWifiOff } from "@tabler/icons-react-native";
import {
  discoverSongs,
  joinArtists,
  ytAlbumSongs,
  type DiscoverSong,
  type QueueContext,
  type YtQuietReason,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CELL, grid } from "@/catalog/grid";
import { PlayShuffle } from "@/catalog/PlayShuffle";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import type { SongRow } from "@/library/LibraryStore";
import { songCount } from "@/library/TrackList";
import { useListScrollable } from "@/motion/heldTouch";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { playDiscoverSongs } from "@/playback/actions";

import { askYtMusic } from "./discover";
import { DiscoverSongRow } from "./DiscoverShelves";
import { useLibraryFinder } from "./libraryFinder";
import type { YtListHead, YtListScreen } from "./routes";
import type { YtMusic, YtMusicError } from "./YtMusic";

/** A YT Music album or playlist page as its screen shows it. */
export interface YtListPage {
  readonly head: YtListHead;
  /** "Album · 2013", "Playlist": what the page is, before its count and length. */
  readonly kind: string;
  readonly songs: readonly NativeYtSong[];
}

/** A page being read: loading, then the page or why it couldn't be read. */
export type YtListLoad =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly page: YtListPage }
  | { readonly status: "quiet"; readonly reason: YtQuietReason };

const LOADING: YtListLoad = { status: "loading" };

/** Reads the page [id] of [screen]: an album's (its songs on it, with its cover) or a playlist's. */
const readPage =
  (screen: YtListScreen, id: string) =>
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
      : ytMusic.playlist(id).pipe(
          Effect.map((playlist) => ({
            head: {
              title: playlist.title,
              line: playlist.author ?? "",
              artworkUrl: playlist.artworkUrl,
            },
            kind: "Playlist",
            songs: playlist.songs,
          })),
        );

/** Reads a YT Music album or playlist page for the screen showing it. */
export const useYtListPage = (screen: YtListScreen, id: string): YtListLoad => {
  const key = `${screen}/${id}`;
  const [answer, setAnswer] = useState<{ readonly key: string; readonly load: YtListLoad } | null>(
    null,
  );
  useEffect(() => {
    let current = true;
    void askYtMusic(readPage(screen, id)).then((result) => {
      if (!current) return;
      setAnswer({
        key: `${screen}/${id}`,
        load: Result.isSuccess(result)
          ? { status: "loaded", page: result.success }
          : { status: "quiet", reason: result.failure.reason === "offline" ? "offline" : "failed" },
      });
    });
    return () => {
      current = false;
    };
  }, [screen, id]);
  return answer?.key === key ? answer.load : LOADING;
};

type Song = DiscoverSong<NativeYtSong, SongRow>;

const totalMinutes = (songs: readonly NativeYtSong[]): string | null => {
  const ms = songs.reduce((total, song) => total + (song.durationMs ?? 0), 0);
  return ms === 0 ? null : `${Math.max(1, Math.round(ms / 60_000))} min`;
};

function Head({
  head,
  furniture,
  onPlay,
}: {
  head: YtListHead;
  furniture: string | null;
  onPlay: ((shuffle: boolean) => void) | null;
}) {
  const { width } = useWindowDimensions();
  return (
    <View style={{ gap: CELL * 2, paddingBottom: CELL }}>
      <Artwork uri={head.artworkUrl ?? undefined} size={width - grid.margin * 2} />
      <View style={{ gap: CELL / 2 }}>
        <Text
          accessibilityRole="header"
          className="font-sans text-title1 font-light text-foreground"
          style={{ letterSpacing: -0.4 }}
        >
          {head.title}
        </Text>
        {head.line !== "" && (
          <Text className="font-sans text-body font-medium text-secondary">{head.line}</Text>
        )}
        {furniture !== null && (
          <Text
            className="font-sans text-footnote text-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {furniture}
          </Text>
        )}
      </View>
      {onPlay !== null && (
        <PlayShuffle onPlay={() => onPlay(false)} onShuffle={() => onPlay(true)} />
      )}
    </View>
  );
}

const keyOf = (song: Song, index: number): string => `${index}-${song.song.videoId}`;

/**
 * A YT Music album or playlist opened from Discover: its cover, title, maker
 * and furniture, Play / Shuffle, then its songs. Songs the Library has play
 * its files; the rest stream. Offline, or when YouTube fails, a quiet empty
 * state takes the songs' place.
 */
export function YtSongList({
  known,
  load,
  context,
  numbered,
}: {
  /** What the tapped cover knew, shown until the page arrives. */
  known: YtListHead | undefined;
  load: YtListLoad;
  context: QueueContext;
  /** An album's songs lead with their number; a playlist's with their cover. */
  numbered: boolean;
}) {
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const find = useLibraryFinder();
  const page = load.status === "loaded" ? load.page : null;
  const songs = useMemo(() => (page === null ? [] : discoverSongs(page.songs, find)), [page, find]);
  const play = useCallback(
    (startIndex: number | undefined, shuffle = false) =>
      void playDiscoverSongs(songs, startIndex, context, { shuffle }),
    [songs, context],
  );
  const head = page?.head ?? known;
  const furniture =
    page === null
      ? null
      : [page.kind, songCount(page.songs.length), totalMinutes(page.songs)]
          .filter((part) => part !== null)
          .join(" · ");

  const renderItem = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <DiscoverSongRow
        song={item}
        trackNumber={numbered ? index + 1 : undefined}
        onPress={() => play(index)}
      />
    ),
    [numbered, play],
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader />
      <LegendList
        scrollEnabled={scrollable}
        className="flex-1"
        data={songs}
        keyExtractor={keyOf}
        renderItem={renderItem}
        getFixedItemSize={() => grid.row}
        estimatedItemSize={grid.row}
        recycleItems
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
        ListHeaderComponent={
          <>
            {head !== undefined && (
              <Head
                head={head}
                furniture={furniture}
                onPlay={songs.length === 0 ? null : (shuffle) => play(undefined, shuffle)}
              />
            )}
            {load.status === "quiet" && (
              <EmptyState
                icon={load.reason === "offline" ? IconWifiOff : IconCloudOff}
                title={
                  load.reason === "offline" ? "You're offline" : "No answer from YouTube Music"
                }
                message={
                  load.reason === "offline"
                    ? "These songs need the network."
                    : "Go back and open it again to try once more."
                }
              />
            )}
          </>
        }
      />
    </View>
  );
}
