import { IconDots } from "@tabler/icons-react-native";
import { playlistSongsLine } from "@wave/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { Mosaic } from "@/catalog/Mosaic";
import { PlayShuffle } from "@/catalog/PlayShuffle";
import { IconButton } from "@/components/IconButton";
import { useRenderCount } from "@/perf/perf";
import { openPlaylistActions } from "@/playback/ActionsMenu";
import { playlistOpened } from "@/library/backgroundFill";
import { DetailFrame } from "@/library/DetailFrame";
import { usePlaylist } from "@/library/hooks";
import { LibraryStore, type PlaylistEntryRow, type PlaylistRow } from "@/library/LibraryStore";
import { PlaylistImportLine } from "@/library/PlaylistImportLine";
import { PlaylistItems, playPlaylistEntries } from "@/library/PlaylistItems";
import { parseId, useKnownRow } from "@/library/routes";
import { appRuntime } from "@/library/runtime";
import { songCount } from "@/library/TrackList";
import { UnavailableTryAgain } from "@/library/UnavailableEntry";
import { YtLibraryReadLine } from "@/library/YtLibraryReadLine";
import { listDownloadAction, useYtPlaylistDownloadButton } from "@/ytmusic/YtSongList";

const NO_ENTRIES: readonly PlaylistEntryRow[] = [];

/** What the screen shows: the playlist, and its songs once they are read. */
interface Shown {
  readonly playlist: PlaylistRow;
  /** Undefined until the songs are read; the header doesn't wait for them. */
  readonly items: readonly PlaylistEntryRow[] | undefined;
}

// oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
const readPlaylist = (id: number) => LibraryStore.use((store) => store.getPlaylist(id));

function PlaylistHead({ shown }: { shown: Shown }) {
  const { width } = useWindowDimensions();
  const { playlist, items } = shown;
  const context = { kind: "playlist", id: String(playlist.id) } as const;
  // The whole list, its YT Music entries streamed, while YT Music is on (`playPlaylistEntries`).
  const play = (shuffle: boolean) => {
    if (items !== undefined) {
      playPlaylistEntries(items, undefined, context, { shuffle });
      return;
    }
    // Tapped before the songs were read: read them now.
    void appRuntime.runPromise(readPlaylist(playlist.id)).then((detail) => {
      if (detail !== null && detail.items.length > 0)
        playPlaylistEntries(detail.items, undefined, context, { shuffle });
    });
  };
  // Its YT Music entries download into the Library (Core's `ytPlaylistDownload`).
  const download = useYtPlaylistDownloadButton(items ?? NO_ENTRIES);
  const count = items?.length ?? playlist.trackCount;
  // Every entry counts, and the line says how many can't play (Core's `playlistSongsLine`).
  const furniture =
    count === 0
      ? songCount(0)
      : `${playlistSongsLine(playlist.trackCount, playlist.unavailableCount)} · ${Math.max(1, Math.round(playlist.durationMs / 60_000))} min`;
  const menu = (
    // Its glyph sits on the right margin, like Back on the left.
    <View style={{ marginRight: -12 }}>
      <IconButton
        icon={IconDots}
        label="Playlist actions"
        opensMenu
        onPress={() => openPlaylistActions(playlist)}
      />
    </View>
  );
  return (
    <View style={{ gap: CELL * 2, paddingBottom: CELL }}>
      <Mosaic paths={playlist.artworkPaths} size={width - grid.margin * 2} />
      <View style={{ gap: CELL / 2 }}>
        <Text
          accessibilityRole="header"
          className="font-sans text-title1 font-light text-foreground"
          style={{ letterSpacing: -0.4 }}
        >
          {playlist.name}
        </Text>
        <Text
          className="font-sans text-footnote text-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {furniture}
        </Text>
        <UnavailableTryAgain playlistId={playlist.id} items={items} />
        {download.progress !== null && (
          <Text
            className="font-sans text-footnote text-accent"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {download.progress}
          </Text>
        )}
        <PlaylistImportLine playlistId={playlist.id} />
        <YtLibraryReadLine playlistId={playlist.id} />
      </View>
      {count > 0 ? (
        <PlayShuffle
          onPlay={() => play(false)}
          onShuffle={() => play(true)}
          last={listDownloadAction(download.button)}
          menu={menu}
        />
      ) : (
        <View className="flex-row justify-end">{menu}</View>
      )}
    </View>
  );
}

function NoSongs() {
  return (
    <View style={{ paddingTop: CELL * 3, gap: CELL / 2 }}>
      <Text className="font-sans text-title3 font-normal text-foreground">No songs yet</Text>
      <Text className="font-sans text-subheadline text-secondary">
        Long-press a song, an album or an artist and choose Add to Playlist.
      </Text>
    </View>
  );
}

/**
 * A playlist: its mosaic, name and length, Play / Shuffle, then its songs in
 * order (drag the grip to reorder, swipe left to remove). Opened from a list
 * that knows the playlist, the header is there on the first frame and the
 * songs follow once read.
 */
export default function PlaylistScreen() {
  useRenderCount("PlaylistScreen");
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlistId = parseId(id);
  const detail = usePlaylist(playlistId);
  const known = useKnownRow("playlist", playlistId);
  // The background fill goes on with the playlist opened last.
  useEffect(() => {
    if (playlistId >= 0) playlistOpened(playlistId);
  }, [playlistId]);
  const shown: Shown | null | undefined =
    detail === undefined && known !== undefined ? { playlist: known, items: undefined } : detail;
  return (
    <DetailFrame detail={shown} noun="playlist" goneMessage="It was deleted.">
      {({ playlist, items }) => (
        <PlaylistItems
          playlistId={playlist.id}
          items={items}
          header={<PlaylistHead shown={{ playlist, items }} />}
          empty={<NoSongs />}
        />
      )}
    </DetailFrame>
  );
}
