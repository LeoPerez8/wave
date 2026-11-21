import {
  nowPlayingDownloadTap,
  parseTrackId,
  type NowPlayingDownloadTap,
  type PlaylistSong,
  type YtSong,
} from "@wave/core";
import type { SongRow } from "@wave/client";
import type { createNowPlayingSongLookup } from "./songLookup.ts";
import type { PlayingSongAnswer, PlayingSongTarget } from "@wave/client";

/** What a tap on Now Playing's Download button does (Core's `nowPlayingDownloadTap`). */
export type PlayingSongDownload = NowPlayingDownloadTap<SongRow, YtSong>;

/** Gesture decisions use the acquired song, never a render's unread placeholder. */
export const createNowPlayingSongActions = (
  lookup: Pick<ReturnType<typeof createNowPlayingSongLookup>, "acquire">,
  ports: {
    readonly download: (command: PlayingSongDownload, target: PlayingSongTarget) => void;
    readonly starred: (target: PlayingSongTarget, answer: PlayingSongAnswer) => boolean;
    readonly star: (target: PlayingSongTarget, answer: PlayingSongAnswer, on: boolean) => void;
    /** Dislikes the song ([on]) or removes its dislike; settles once that is saved. */
    readonly dislike: (
      target: PlayingSongTarget,
      answer: PlayingSongAnswer,
      on: boolean,
    ) => Promise<void>;
  },
) => {
  // Keep rapid toggles in gesture order, without waiting for their writes/downloads.
  const stars = new Map<string, Promise<void>>();
  return {
    async playlist(target: PlayingSongTarget): Promise<readonly PlaylistSong[]> {
      const answer = await lookup.acquire(target);
      if (answer.track !== null) return [{ source: "library", trackId: answer.track.id }];
      return target.song === null ? [] : [{ source: "stream", song: target.song }];
    },
    async download(target: PlayingSongTarget): Promise<void> {
      const { track } = await lookup.acquire(target);
      ports.download(nowPlayingDownloadTap(track, target.song), target);
    },
    star(target: PlayingSongTarget, addOnly = false): Promise<void> {
      const previous = stars.get(target.trackId) ?? Promise.resolve();
      const pending = previous
        .catch(() => {})
        .then(async () => {
          const answer = await lookup.acquire(target);
          if (answer.track === null && parseTrackId(target.trackId)?.kind !== "yt") return;
          ports.star(target, answer, addOnly || !ports.starred(target, answer));
        });
      stars.set(target.trackId, pending);
      void pending
        .finally(() => {
          if (stars.get(target.trackId) === pending) stars.delete(target.trackId);
        })
        .catch(() => {});
      return pending;
    },
    /**
     * Dislikes the captured song ([on], what the button showed it would do) or
     * removes its dislike, as the Library's song when the Library has it. An
     * entry with neither a Library song nor a video has nothing to be disliked by.
     */
    async dislike(target: PlayingSongTarget, on: boolean): Promise<void> {
      const answer = await lookup.acquire(target);
      if (answer.track === null && parseTrackId(target.trackId)?.kind !== "yt") return;
      await ports.dislike(target, answer, on);
    },
  };
};
