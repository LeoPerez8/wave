import { fileUri } from "../lib/fileUri.ts";
import type { ListeningHistoryRow } from "./db/listeningHistory.ts";

/**
 * A History row's cover. A Library play shows the cover it was played with,
 * else (a play from another phone keeps no local paths) its song's current
 * one, else the remote cover it synced with. A stream shows its downloaded
 * song's cover, else its remote one while it can play.
 */
export const historyArtworkUri = (
  { videoId, snapshot, song }: Pick<ListeningHistoryRow, "videoId" | "snapshot" | "song">,
  streamPlayable: boolean,
): string | undefined =>
  videoId === null
    ? (fileUri(
        snapshot.thumbPath ?? snapshot.artworkPath ?? song?.thumbPath ?? song?.artworkPath,
      ) ??
      snapshot.artworkUrl ??
      undefined)
    : song !== null
      ? fileUri(song.thumbPath ?? song.artworkPath)
      : streamPlayable
        ? (snapshot.artworkUrl ?? undefined)
        : undefined;
