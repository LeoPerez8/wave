import { joinArtists, unsearchedTrackId, type UnsearchedSong } from "@wave/core";
import type { ComponentProps } from "react";

import { TrackRow } from "@/catalog/TrackRow";
import { useYtMusicEnabled } from "@/settings/ytMusic";

/**
 * A playlist's unsearched entry (a song a Spotify import listed, not
 * searched yet) as a Songs-list row, as any other song shows: Spotify's
 * cover (while YT Music is on, as a YT Music entry's), its title, its
 * artists and album, its length. Not dimmed, no marker: it plays, searched
 * as it's about to.
 */
export function UnsearchedSongRow({
  song,
  playing,
  checked,
  onPress,
  onLongPress,
  accessibilityActions,
  onAccessibilityAction,
}: {
  song: UnsearchedSong;
  playing: boolean;
  checked?: boolean | undefined;
  onPress: () => void;
  onLongPress: () => void;
  accessibilityActions?: ComponentProps<typeof TrackRow>["accessibilityActions"];
  onAccessibilityAction?: ComponentProps<typeof TrackRow>["onAccessibilityAction"];
}) {
  // With YT Music off (a playlist's entries still show) Wave asks for no cover.
  const ytMusic = useYtMusicEnabled();
  const credit = [joinArtists(song.artists), song.album]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
  return (
    <TrackRow
      track={{
        id: unsearchedTrackId(song),
        title: song.title,
        artist: credit,
        durationMs: song.durationMs,
        artworkUri: ytMusic ? (song.artworkUrl ?? undefined) : undefined,
      }}
      state={playing ? "playing" : undefined}
      checked={checked}
      leading="artwork"
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
    />
  );
}
