import { IconDots } from "@tabler/icons-react-native";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { Mosaic } from "@/catalog/Mosaic";
import { PlayShuffle } from "@/catalog/PlayShuffle";
import { IconButton } from "@/components/IconButton";
import { playSongs } from "@/playback/actions";
import { openPlaylistActions } from "@/playback/ActionsMenu";
import { DetailFrame } from "@/library/DetailFrame";
import { usePlaylist } from "@/library/hooks";
import { LibraryStore, type PlaylistItemRow, type PlaylistRow } from "@/library/LibraryStore";
import { PlaylistItems } from "@/library/PlaylistItems";
import { knownPlaylist } from "@/library/playlists";
import { parseId } from "@/library/routes";
import { appRuntime } from "@/library/runtime";
import { songCount } from "@/library/TrackList";

/** What the screen shows: the playlist, and its songs once they are read. */
interface Shown {
  readonly playlist: PlaylistRow;
  /** Undefined until the songs are read; the header doesn't wait for them. */
  readonly items: readonly PlaylistItemRow[] | undefined;
}

const readPlaylist = (id: number) => LibraryStore.use((store) => store.getPlaylist(id));

function PlaylistHead({ shown }: { shown: Shown }) {
  const { width } = useWindowDimensions();
  const { playlist, items } = shown;
  const context = { kind: "playlist", id: String(playlist.id) } as const;
  const play = (shuffle: boolean) => {
    if (items !== undefined) {
      playSongs(items, undefined, context, { shuffle });
      return;
    }
    // Tapped before the songs were read: read them now.
    void appRuntime.runPromise(readPlaylist(playlist.id)).then((detail) => {
      if (detail !== null && detail.items.length > 0)
        playSongs(detail.items, undefined, context, { shuffle });
    });
  };
  const count = items?.length ?? playlist.trackCount;
  const furniture =
    count === 0
      ? songCount(0)
      : `${songCount(playlist.trackCount)} · ${Math.max(1, Math.round(playlist.durationMs / 60_000))} min`;
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
      </View>
      <View className="flex-row items-center justify-between">
        {count > 0 ? (
          <PlayShuffle onPlay={() => play(false)} onShuffle={() => play(true)} />
        ) : (
          <View />
        )}
        {/* Its glyph sits on the right margin, like Back on the left. */}
        <View style={{ marginRight: -12 }}>
          <IconButton
            icon={IconDots}
            label="Playlist actions"
            opensMenu
            onPress={() => openPlaylistActions(playlist)}
          />
        </View>
      </View>
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlistId = parseId(id);
  const detail = usePlaylist(playlistId);
  const [known] = useState(() => knownPlaylist(playlistId));
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
