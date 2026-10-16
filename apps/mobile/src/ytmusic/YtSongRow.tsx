import {
  ytDownloadLine,
  ytDownloadProgress,
  ytSongArtist,
  ytSongCredit,
  ytTrackId,
} from "@wave/core";
import type { ComponentProps } from "react";

import { TrackRow } from "@/catalog/TrackRow";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { useYtDownloadStatus } from "./YtDownloads";
import { openYtSongActions } from "./YtSongActions";

/**
 * A YT Music song as a Songs-list row: YouTube's cover, the artists and
 * album, the length (on an album's tracklist, its number and the artists
 * only). Its long-press menu queues or downloads it. While it downloads, the
 * second line says how far along it is, over a progress rule.
 */
export function YtSongRow({
  song,
  playing,
  checked,
  onPress,
  onLongPress = () => openYtSongActions(song),
  trackNumber,
  kind = "",
  accessibilityActions,
  onAccessibilityAction,
}: {
  song: NativeYtSong;
  playing: boolean;
  checked?: boolean | undefined;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  /** Leads with this number instead of the cover (an album's tracklist). */
  trackNumber?: number | undefined;
  /** Says what the row is before its artists ("Song · ", Search's top result). */
  kind?: string | undefined;
  /** Screen-reader actions standing in for gestures (move, remove in a playlist). */
  accessibilityActions?: ComponentProps<typeof TrackRow>["accessibilityActions"];
  onAccessibilityAction?: ComponentProps<typeof TrackRow>["onAccessibilityAction"];
}) {
  const download = useYtDownloadStatus(song.videoId);
  // With YT Music off (a playlist's entries still show) Wave asks YouTube for nothing, covers included.
  const ytMusic = useYtMusicEnabled();
  return (
    <TrackRow
      track={{
        id: ytTrackId(song.videoId),
        title: song.title,
        artist:
          ytDownloadLine(download) ??
          kind + (trackNumber === undefined ? ytSongCredit(song) : ytSongArtist(song)),
        durationMs: song.durationMs,
        trackNumber,
        artworkUri: ytMusic ? (song.artworkUrl ?? undefined) : undefined,
      }}
      state={playing ? "playing" : undefined}
      checked={checked}
      leading={trackNumber === undefined ? "artwork" : "number"}
      progress={ytDownloadProgress(download)}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
    />
  );
}
