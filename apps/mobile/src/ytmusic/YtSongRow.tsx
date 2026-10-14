import {
  ytDownloadLine,
  ytDownloadProgress,
  ytSongArtist,
  ytSongCredit,
  ytTrackId,
} from "@wave/core";

import { TrackRow } from "@/catalog/TrackRow";
import type { NativeYtSong } from "@/native/waveYtMusic";

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
  onPress,
  onLongPress = () => openYtSongActions(song),
  trackNumber,
  kind = "",
}: {
  song: NativeYtSong;
  playing: boolean;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  /** Leads with this number instead of the cover (an album's tracklist). */
  trackNumber?: number | undefined;
  /** Says what the row is before its artists ("Song · ", Search's top result). */
  kind?: string | undefined;
}) {
  const download = useYtDownloadStatus(song.videoId);
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
        artworkUri: song.artworkUrl ?? undefined,
      }}
      state={playing ? "playing" : undefined}
      leading={trackNumber === undefined ? "artwork" : "number"}
      progress={ytDownloadProgress(download)}
      onPress={onPress}
      onLongPress={onLongPress}
    />
  );
}
