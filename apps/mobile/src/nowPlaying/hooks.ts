import {
  groundGradient,
  NOW_PLAYING_FADE,
  parseTrackId,
  type ArtworkPalette,
  type GroundFade,
  type GroundGradient,
  type QueueEntry,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";

import { LibraryStore } from "@/library/LibraryStore";
import { type TrackDetails } from "@wave/client";
import { appRuntime } from "@/library/runtime";
import type { NativeYtSong } from "@/native/waveYtMusic";
import {
  learnUnknownQueueTracks,
  queuedYtSong,
  queueTracks,
  type QueueTrack,
} from "@/playback/queueTracks";
import { savedYtQueueTracks } from "@/playback/savedYtTracks";
import { useThemeColor } from "@/theme/useThemeColor";
import { usePlayingSongAnswer, usePlayingSongTarget } from "./playingSong";

/**
 * The playing track's album and artist (for the links) and palette, from the
 * library; null for a YT Music song, which isn't in it.
 */
export const useTrackDetails = (trackId: string | null): TrackDetails | null => {
  const [details, setDetails] = useState<TrackDetails | null>(null);
  const track = trackId === null ? null : parseTrackId(trackId);
  const libraryId = track?.kind === "library" ? track.id : null;
  useEffect(() => {
    if (libraryId === null) return undefined;
    let current = true;
    appRuntime
      .runPromise(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          return yield* store.trackDetails(libraryId);
        }),
      )
      .then((result) => {
        if (current) setDetails(result);
      })
      .catch(() => {
        if (current) setDetails(null);
      });
    return () => {
      current = false;
    };
  }, [libraryId]);
  return details !== null && String(details.id) === trackId ? details : null;
};

/**
 * The YT Music song [trackId] streams, as the queue keeps it (`queuedYtSong`):
 * null for a Library track.
 */
export const usePlayingYtSong = (trackId: string | null): NativeYtSong | null => {
  const track = useSyncExternalStore(queueTracks.subscribe, () =>
    trackId === null ? null : (queueTracks.get().get(trackId) ?? null),
  );
  return useMemo(() => (track === null ? null : queuedYtSong(track)), [track]);
};

/** A Library track and its file. */
export interface LibraryFile {
  readonly id: number;
  readonly path: string;
}

/** The shared playing-song answer's file; unread until settlement or an early gesture. */
export const useDownloadedFile = (ytSong: NativeYtSong | null): LibraryFile | null | undefined => {
  const target = usePlayingSongTarget(ytSong === null ? null : `yt:${ytSong.videoId}`, ytSong);
  const answer = usePlayingSongAnswer(target);
  if (ytSong === null) return null;
  if (answer === undefined) return undefined;
  const track = answer.track;
  return track?.path == null ? null : { id: track.id, path: track.path };
};

/**
 * The palette Now Playing is tinted from: the Library track's artwork's, or a
 * YT Music song's cached cover's (kept with the queue's tracks).
 */
export const useNowPlayingPalette = (
  trackId: string | null,
  details: TrackDetails | null,
): ArtworkPalette | null => {
  const streamed = useSyncExternalStore(queueTracks.subscribe, () =>
    trackId === null || details !== null ? null : (queueTracks.get().get(trackId)?.palette ?? null),
  );
  return details?.palette ?? streamed;
};

const isHex = (colour: string): boolean => /^#[0-9a-f]{6}$/i.test(colour);

/** Now Playing's ground with text over all of it: the whole height kept readable. */
const TEXT_EVERYWHERE = { ...NOW_PLAYING_FADE, legibleFrom: 0 };

/**
 * The ground for [palette] along [fade] (Core's `groundGradient`), toned so
 * Wave's ink, graphite and teal stay readable where [fade] keeps text. The
 * plain ground without a palette, or while the theme's colours aren't plain hex.
 */
export const useThemedGround = (
  palette: ArtworkPalette | null,
  fade: GroundFade,
): GroundGradient => {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const ground = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const secondary = useThemeColor("secondary");
  const accent = useThemeColor("accent");
  return useMemo(() => {
    const ink = [foreground, secondary, accent];
    if (!isHex(ground) || !ink.every(isHex)) {
      return [
        { color: ground, at: 0 },
        { color: ground, at: 1 },
      ];
    }
    return groundGradient(palette, { scheme, ground, ink }, fade);
  }, [palette, fade, scheme, ground, foreground, secondary, accent]);
};

/**
 * The ground for the playing artwork: its main colour at the top, through its
 * second, into the theme's ground (`useThemedGround`). On the player text is
 * kept readable from the title down; [textEverywhere] (Lyrics, the Queue)
 * keeps the whole height readable.
 */
export const useNowPlayingGradient = (
  palette: ArtworkPalette | null,
  textEverywhere: boolean,
): GroundGradient => useThemedGround(palette, textEverywhere ? TEXT_EVERYWHERE : NOW_PLAYING_FADE);

/**
 * The queue's tracks by id, as the Queue service learned them with the
 * commands that queued them, so the rows are filled on the first frame. Only
 * tracks it doesn't know (a queue picked back up from the player after JS
 * restarted) are looked up in the library, once for the app's lifetime.
 */
export const useQueueTracks = (entries: readonly QueueEntry[]): ReadonlyMap<string, QueueTrack> => {
  const tracks = useSyncExternalStore(queueTracks.subscribe, queueTracks.get);
  useEffect(() => {
    void appRuntime.runPromise(
      // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
      LibraryStore.use((store) =>
        learnUnknownQueueTracks(entries, store.songsByIds, savedYtQueueTracks),
      ),
    );
  }, [entries]);
  return tracks;
};
