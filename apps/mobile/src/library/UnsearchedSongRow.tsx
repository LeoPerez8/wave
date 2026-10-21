import {
  joinArtists,
  unsearchedTrackId,
  ytDownloadLine,
  ytDownloadProgress,
  type UnsearchedSong,
} from "@wave/core";
import type { ComponentProps } from "react";

import type { RowSwipe } from "@/catalog/SwipeableRow";
import { TrackRow } from "@/catalog/TrackRow";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { useYtDownloadStatus } from "@/ytmusic/YtDownloads";

/**
 * A playlist's unsearched entry (a song a Spotify import listed, not
 * searched yet) as a Songs-list row, as any other song shows: Spotify's
 * cover (while YT Music is on, as a YT Music entry's), its title, its
 * artists and album, its length. Not dimmed, no marker: it plays, searched
 * as it's about to. While it downloads (its job goes by its unsearched id),
 * the row shows its progress as a YT Music entry's does.
 */
export function UnsearchedSongRow({
  song,
  playing,
  checked,
  onPress,
  onLongPress,
  accessibilityActions,
  onAccessibilityAction,
  swipe,
}: {
  song: UnsearchedSong;
  playing: boolean;
  checked?: boolean | undefined;
  onPress: () => void;
  onLongPress: () => void;
  accessibilityActions?: ComponentProps<typeof TrackRow>["accessibilityActions"];
  onAccessibilityAction?: ComponentProps<typeof TrackRow>["onAccessibilityAction"];
  /** What swiping the row runs (`useUnsearchedSwipe`); undefined, it doesn't swipe. */
  swipe?: RowSwipe | undefined;
}) {
  // With YT Music off (a playlist's entries still show) Wave asks for no cover.
  const ytMusic = useYtMusicEnabled();
  const id = unsearchedTrackId(song);
  const download = useYtDownloadStatus(id);
  const credit = [joinArtists(song.artists), song.album]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
  return (
    <TrackRow
      track={{
        id,
        title: song.title,
        artist: ytDownloadLine(download) ?? credit,
        durationMs: song.durationMs,
        artworkUri: ytMusic ? (song.artworkUrl ?? undefined) : undefined,
      }}
      state={playing ? "playing" : undefined}
      checked={checked}
      leading="artwork"
      progress={ytDownloadProgress(download)}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      swipe={swipe}
    />
  );
}
