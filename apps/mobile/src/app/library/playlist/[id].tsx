import { IconDots } from "@tabler/icons-react-native";
import { useLocalSearchParams } from "expo-router";
import { Text, useWindowDimensions, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { Mosaic } from "@/catalog/Mosaic";
import { PlayShuffle } from "@/catalog/PlayShuffle";
import { IconButton } from "@/components/IconButton";
import { playSongs } from "@/playback/actions";
import { openPlaylistActions } from "@/playback/TrackActionsSheet";
import { DetailFrame } from "@/library/DetailFrame";
import { usePlaylist } from "@/library/hooks";
import type { PlaylistDetail } from "@/library/LibraryStore";
import { PlaylistItems } from "@/library/PlaylistItems";
import { parseId } from "@/library/routes";
import { songCount } from "@/library/TrackList";

function PlaylistHead({ detail }: { detail: PlaylistDetail }) {
  const { width } = useWindowDimensions();
  const { playlist, items } = detail;
  const context = { kind: "playlist", id: String(playlist.id) } as const;
  const furniture =
    items.length === 0
      ? songCount(0)
      : `${songCount(playlist.trackCount)} · ${Math.max(1, Math.round(playlist.durationMs / 60_000))} min`;
  return (
    <View style={{ gap: CELL * 2, paddingBottom: CELL }}>
      <Mosaic paths={detail.artworkPaths} size={width - grid.margin * 2} />
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
        {items.length > 0 ? (
          <PlayShuffle
            onPlay={() => playSongs(items, undefined, context, { shuffle: false })}
            onShuffle={() => playSongs(items, undefined, context, { shuffle: true })}
          />
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
 * order (drag the grip to reorder, swipe left to remove).
 */
export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = usePlaylist(parseId(id));
  return (
    <DetailFrame detail={detail} noun="playlist" goneMessage="It was deleted.">
      {(playlist) => (
        <PlaylistItems
          detail={playlist}
          header={<PlaylistHead detail={playlist} />}
          empty={<NoSongs />}
        />
      )}
    </DetailFrame>
  );
}
