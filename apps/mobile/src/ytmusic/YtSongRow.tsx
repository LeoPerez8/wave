import {
  showsExplicitBadge,
  ytDownloadLine,
  ytDownloadProgress,
  ytSongArtist,
  ytSongCredit,
  ytTrackId,
} from "@wave/core";
import type { ComponentProps } from "react";

import type { RowSwipe } from "@/catalog/SwipeableRow";
import { TrackRow } from "@/catalog/TrackRow";
import { useIsFavorite } from "@/library/favorites";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { useYtDownloadStatus } from "./YtDownloads";
import { openYtSongActions, useYtSongSwipe } from "./YtSongActions";

/**
 * A YT Music song as a Songs-list row: YouTube's cover, the artists and
 * album, the length (on an album's tracklist, its number and the artists
 * only), and its star once starred (a pending favorite: the Library doesn't
 * have it, or the list would show the Library's row). Its long-press menu
 * queues or downloads it. While it downloads, the
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
  swipe,
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
  /** What swiping the row runs (`useYtSongSwipe`); undefined, it doesn't swipe. */
  swipe?: RowSwipe | undefined;
}) {
  const download = useYtDownloadStatus(song.videoId);
  const favorite = useIsFavorite(ytTrackId(song.videoId));
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
        explicit: showsExplicitBadge(song.explicit),
      }}
      state={playing ? "playing" : undefined}
      favorite={favorite}
      checked={checked}
      leading={trackNumber === undefined ? "artwork" : "number"}
      progress={ytDownloadProgress(download)}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      swipe={swipe}
    />
  );
}

/**
 * A YT Music song's row in a list of songs: a `YtSongRow` that swipes to run
 * its menu's entries (right Add to Queue; `useYtSongSwipe`).
 */
export function SwipeYtSongRow(props: Omit<ComponentProps<typeof YtSongRow>, "swipe">) {
  const swipe = useYtSongSwipe(props.song);
  return <YtSongRow {...props} swipe={swipe} />;
}
