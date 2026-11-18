import type { SongRowArtwork } from "@wave/core";
import { artworkUri } from "@wave/client/artworkUri";
import type { ListeningHistoryRow } from "@wave/client/db/listeningHistory";

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
    ? (artworkUri(snapshot) ?? artworkUri(song) ?? snapshot.artworkUrl ?? undefined)
    : song !== null
      ? artworkUri(song)
      : streamPlayable
        ? (snapshot.artworkUrl ?? undefined)
        : undefined;

/**
 * A History row's cover as the song row takes it: the address
 * `historyArtworkUri` chose, a web cover as a remote one (the policy already
 * decided it may show), anything else as the file it is.
 */
export const historyArtwork = (
  play: Pick<ListeningHistoryRow, "videoId" | "snapshot" | "song">,
  streamPlayable: boolean,
): SongRowArtwork => {
  const uri = historyArtworkUri(play, streamPlayable);
  if (uri === undefined) return { kind: "placeholder" };
  return /^https?:/i.test(uri)
    ? { kind: "remote", url: uri, size: "thumbnail" }
    : { kind: "file", files: { artworkPath: uri } };
};
