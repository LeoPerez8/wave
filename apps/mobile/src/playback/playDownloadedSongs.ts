/**
 * Play Downloaded Songs (docs/spec.md, Resume on reconnect; #1503): while
 * the playing song waits for the network (Offline or Slow), Now Playing
 * offers to play something on the phone. Core decides what
 * (`playDownloadedSongs`): the next queue entry on the phone, else Library
 * songs seeded from the stalled song's artists, played next as a new queue
 * with Undo. Leaving the stalled song this way ends its play as interrupted.
 */
import {
  isExplicit,
  isMagicQueue,
  magicLibraryMapperSteps,
  mapSteps,
  parseTrackId,
  playDownloadedSongsShows,
  playDownloadedSongsSteps,
  splitCredit,
  finishSteps,
  type MagicSong,
  type NetworkSignal,
  type QueueState,
} from "@wave/core";
import { songHasFile, type SongRow } from "@wave/client";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { recommendationSnapshot } from "@/home/recommendationSnapshot";
import { namedWork } from "@/lib/stepped";
import { dislikedSongsNow, onDislikesChanged } from "@/library/dislikes";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { appLog } from "@/log/appLog";
import { dontPlayExplicit } from "@/settings/dontPlayExplicit";

import { magicSession } from "./magicSessionStore";
import { leavingStalledEntry } from "./PlayHistory";
import { playbackState } from "./Player";
import { Queue, queueState, toQueueTrack } from "./Queue";
import { queueTracks } from "./queueTracks";
import { latestTasteProfile } from "./TasteProfile";

/** The Library as the recommendation snapshot reads it: its songs and artists. */
interface Library {
  readonly songs: readonly SongRow[];
  readonly artists: readonly { readonly id: number; readonly name: string }[];
}

/** The Library's songs that can play now: with their file, and not explicit while Don't play explicit is on. */
const playableSongs = (library: Library): SongRow[] => {
  const clean = dontPlayExplicit();
  return library.songs.filter((song) => songHasFile(song) && !(clean && isExplicit(song.explicit)));
};

/**
 * The Track id a queue song plays from on the phone (Core's `onPhone`): a
 * Library song's own while the Library has its file, a YT Music song's
 * Library copy ([copies], by video id) when it was downloaded since.
 */
const onPhoneOf =
  (playable: ReadonlySet<string>, copies: ReadonlyMap<string, SongRow> = new Map()) =>
  (trackId: string): string | null => {
    const ref = parseTrackId(trackId);
    if (ref?.kind === "library") return playable.has(trackId) ? trackId : null;
    if (ref?.kind !== "yt") return null;
    const copy = copies.get(ref.videoId);
    return copy !== undefined && playable.has(String(copy.id)) ? String(copy.id) : null;
  };

/** As little of a song as the button's check needs: its id, for dislikes. */
const bare = (song: SongRow): MagicSong => ({
  trackId: String(song.id),
  artists: [],
  genre: null,
  style: null,
});

const readLibrary = (): Promise<Library> =>
  appRuntime.runPromise(
    Effect.map(recommendationSnapshot.library, (library): Library => library).pipe(
      namedWork("Play Downloaded Songs"),
    ),
  );

/**
 * Whether Play Downloaded Songs shows under Now Playing's controls: the song
 * is Offline or Slow ([signal]) and something on the phone can play (Core's
 * `playDownloadedSongsShows`). Until the Library is read it doesn't show.
 */
export const usePlayDownloadedSongs = (signal: NetworkSignal): boolean => {
  const stalled = signal === "offline" || signal === "slow";
  const state = useSyncExternalStore(queueState.subscribe, queueState.get);
  const [library, setLibrary] = useState<Library | null>(
    () => recommendationSnapshot.peek().library,
  );
  const [dislikes, setDislikes] = useState(dislikedSongsNow);
  useEffect(() => onDislikesChanged(() => setDislikes(dislikedSongsNow())), []);
  useEffect(() => {
    if (!stalled) return;
    let live = true;
    readLibrary().then(
      (read) => live && setLibrary(read),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [stalled]);
  const playable = useMemo(
    () => (stalled && library !== null ? playableSongs(library) : null),
    [stalled, library],
  );
  return useMemo(() => {
    if (playable === null) return false;
    const ids = new Set(playable.map((song) => String(song.id)));
    return playDownloadedSongsShows(state, playable.map(bare), {
      onPhone: onPhoneOf(ids),
      stalledArtists: [],
      disliked: dislikes,
    });
  }, [state, playable, dislikes]);
};

const readLibraryEffect: Effect.Effect<Library> = Effect.promise(readLibrary);

/** The stalled song's artists, by name, as the queue knows them. */
const stalledArtists = (state: QueueState): readonly string[] => {
  const entry = state.entries[state.index];
  const track = entry === undefined ? undefined : queueTracks.get().get(entry.trackId);
  if (track === undefined) return [];
  return track.artists ?? splitCredit(track.artist);
};

/** Plays what Core picks: the next song on the phone, else Library songs like the stalled one. */
const play = Effect.gen(function* () {
  const store = yield* LibraryStore;
  const queue = yield* Queue;
  const state = queueState.get();
  const current = state.entries[state.index];
  if (current === undefined) return;
  const library: Library = recommendationSnapshot.peek().library ?? (yield* readLibraryEffect);
  const playable = playableSongs(library);
  const ids = new Set(playable.map((song) => String(song.id)));
  const videoIds = state.entries.flatMap((entry) => {
    const ref = parseTrackId(entry.trackId);
    return ref?.kind === "yt" ? [ref.videoId] : [];
  });
  const copies =
    videoIds.length === 0
      ? new Map<string, SongRow>()
      : yield* store.songsWithVideos(videoIds).pipe(Effect.orElseSucceed(() => new Map()));
  const active = magicSession.get();
  const session = active !== null && isMagicQueue(active, state) ? active : null;
  const moodFeatures =
    (session?.dj?.mood ?? []).length === 0
      ? new Map()
      : yield* store.djLibraryMoodFeatures().pipe(Effect.orElseSucceed(() => new Map()));
  const mapSong = finishSteps(magicLibraryMapperSteps(library.artists));
  const songs = finishSteps(mapSteps(playable, mapSong));
  const pick = finishSteps(
    playDownloadedSongsSteps(state, songs, {
      onPhone: onPhoneOf(ids, copies),
      stalledArtists: stalledArtists(state),
      session,
      moodFeatures,
      disliked: dislikedSongsNow(),
      graph: recommendationSnapshot.peek().graph,
      taste: latestTasteProfile(),
    }),
  );
  if (pick === null) return;
  // The queue moved on meanwhile: what was picked is no longer what's stalled.
  if (queueState.get() !== state) return;
  const rows = new Map(playable.map((song) => [String(song.id), song] as const));
  const tracks = (trackIds: readonly string[]) =>
    trackIds.flatMap((id) => {
      const row = rows.get(id);
      return row !== undefined && songHasFile(row) ? [toQueueTrack(row)] : [];
    });
  // Its play ends as interrupted, as leaving a song the network stalled does.
  leavingStalledEntry.set(current.key);
  try {
    if (pick.kind === "next") {
      const entry = state.entries.find((each) => each.key === pick.key);
      const becomes = entry?.trackId === pick.trackId ? undefined : pick.trackId;
      yield* queue.dispatch(
        { type: "jumpTo", key: pick.key, becomes },
        becomes === undefined ? [] : tracks([becomes]),
      );
    } else {
      yield* queue.dispatch(
        { type: "playNow", trackIds: pick.trackIds, newQueue: true },
        tracks(pick.trackIds),
      );
    }
    appLog(
      "info",
      "PlayDownloadedSongs",
      pick.kind === "next"
        ? "Went on to the next song on the phone"
        : `Playing ${pick.trackIds.length} Library songs next`,
    );
  } finally {
    leavingStalledEntry.set(null);
  }
});

/** Play Downloaded Songs' tap: plays what Core picks, reporting a failure as the playback error. */
export const playDownloadedSongs = (): Promise<void> =>
  appRuntime.runPromise(play).catch((error: unknown) =>
    playbackState.update((previous) => ({
      ...previous,
      error: error instanceof Error ? error.message : String(error),
    })),
  );
