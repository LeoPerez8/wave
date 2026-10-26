import {
  showsExplicitBadge,
  ytDownloadLine,
  ytDownloadProgress,
  ytSongArtist,
  ytSongCredit,
  ytTrackId,
} from "@wave/core";
import { useSyncExternalStore, type ComponentProps } from "react";

import type { RowSwipe } from "@/catalog/SwipeableRow";
import { TrackRow } from "@/catalog/TrackRow";
import { useIsFavorite } from "@/library/favorites";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { unavailableStreamedVideos } from "@/playback/PlayHistory";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { useYtDownloadStatus } from "./YtDownloads";
import { openYtSongActions, useYtSongSwipe } from "./YtSongActions";

/**
 * Whether streaming [videoId] can play now: YT Music is on and the video
 * didn't refuse to play this session.
 */
export const useStreamPlayable = (videoId: string): boolean => {
  const ytMusic = useYtMusicEnabled();
  const unavailable = useSyncExternalStore(
    unavailableStreamedVideos.subscribe,
    unavailableStreamedVideos.get,
  );
  return ytMusic && !unavailable.has(videoId);
};

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
  popularRank,
  kind = "",
  playDisc,
  plays,
  unavailable,
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
  /** Leads with a Popular rank, with the first in ember, keeping the song's usual credit. */
  popularRank?: number | undefined;
  /** Says what the row is before its artists ("Song · ", Search's song results). */
  kind?: string | undefined;
  /** The cover is a song card's, with a play disc on its corner (`TrackRow`'s `playDisc`). */
  playDisc?: boolean | undefined;
  /** On a ranking by plays, its counted plays, shown in place of its length. */
  plays?: number | undefined;
  /** It can't play now (YT Music off, in a ranking): dimmed; the caller makes a tap do nothing. */
  unavailable?: boolean | undefined;
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
        trackNumber: popularRank ?? trackNumber,
        artworkUri: ytMusic ? (song.artworkUrl ?? undefined) : undefined,
        explicit: showsExplicitBadge(song.explicit),
      }}
      state={playing ? "playing" : undefined}
      favorite={favorite}
      checked={checked}
      leading={popularRank === undefined && trackNumber === undefined ? "artwork" : "number"}
      topNumber={popularRank === 1}
      playDisc={playDisc}
      plays={plays}
      unavailable={unavailable}
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

/**
 * A streamed song's row in a ranking by plays (Stats' songs, Home's Most
 * played): a `SwipeYtSongRow`, dimmed with its tap doing nothing while it
 * can't play (`useStreamPlayable`); its cover is YouTube's only with YT Music on.
 */
export function RankedYtSongRow(
  props: Omit<ComponentProps<typeof YtSongRow>, "swipe" | "unavailable">,
) {
  const playable = useStreamPlayable(props.song.videoId);
  return (
    <SwipeYtSongRow {...props} unavailable={!playable} onPress={playable ? props.onPress : noop} />
  );
}

const noop = (): void => {};
