/**
 * Searching the queue's unsearched songs as they're about to play
 * (docs/spec.md, YT Music, "Unavailable entries"): whenever the queue
 * changes, the unsearched songs among the playing one and the next 3, in
 * play order, shuffle included (Core's `playingSearches`), are searched with
 * the playing priority in the shared allowance and settled in every playlist
 * holding them (`searchUnsearchedSong`). Found, the queue's entries become
 * the YT Music song and the player takes them; not found, they leave the
 * queue with a notice naming the song. A failed search leaves the song
 * unsearched: it's asked again a while later, and the player passes over it
 * meanwhile. The queue waits for the playing song's own search through
 * `searchPlaying`, which joins the one going on. With crossfade on, the
 * next song is asked again at the playing one's prefetch point (Core's
 * `crossfadePrefetchAt`) even if its last search failed a moment ago, so a
 * found song reaches the player before the overlap.
 */
import {
  crossfadePrefetchAt,
  currentEntry,
  explicitSkipNotice,
  extrapolatePosition,
  playingAnswerStep,
  playingSearches,
  readUnsearchedTrackId,
  ytTrackId,
  PLAYING_SEARCH_RETRY_MS,
  type UnsearchedSettlement,
  type YtAlbumSong,
} from "@wave/core";

import { appRuntime } from "@/library/runtime";
import { searchUnsearchedSong } from "@/library/unsearchedEntries";
import { showToast } from "@/overlay/toast";
import { crossfadeMs } from "@/settings/crossfade";
import { dontPlayExplicit } from "@/settings/dontPlayExplicit";
import { ytMusicEnabled } from "@/settings/ytMusic";

import { playbackState } from "./Player";
import { setPlayingSearcher } from "./playingSearch";
import { Queue, queueState } from "./Queue";
import { learnQueueTracks, toYtQueueTrack } from "./queueTracks";
import { cacheYtCoversInBackground } from "./ytQueueTracks";

type Settlement = UnsearchedSettlement<YtAlbumSong>;

/** The searches going on, by the song's queue id. */
const asking = new Map<string, Promise<Settlement | null>>();
/** When each song's last search failed, by its queue id: asked again only a while later. */
const failedAt = new Map<string, number>();

/**
 * Searches the unsearched song [trackId] stands for with the playing
 * priority and settles it, or joins the search for it going on. Found, the
 * queue learns the YT Music song (its cover cached in the background).
 */
const search = (trackId: string): Promise<Settlement | null> => {
  const going = asking.get(trackId);
  if (going !== undefined) return going;
  const song = readUnsearchedTrackId(trackId);
  if (song === null) return Promise.resolve(null);
  const searched = (async (): Promise<Settlement | null> => {
    try {
      const settled = await searchUnsearchedSong(song, "playing").catch((): Settlement => ({
        kind: "failed",
        reason: "failed",
      }));
      if (settled?.kind === "failed") failedAt.set(trackId, Date.now());
      else failedAt.delete(trackId);
      if (settled?.kind === "found") {
        const found = settled.becomes.song;
        learnQueueTracks([toYtQueueTrack(found, null)]);
        appRuntime.runFork(cacheYtCoversInBackground([found]));
      }
      return settled;
    } finally {
      asking.delete(trackId);
    }
  })();
  asking.set(trackId, searched);
  return searched;
};

const dispatch = (trackId: string, becomes: string | null): Promise<void> =>
  appRuntime
    .runPromise(
      // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
      Queue.use((queue) => queue.dispatch({ type: "settled", trackId, becomes })),
    )
    .catch(() => undefined);

/**
 * What a search of a song coming up settled does to the queue. The playing
 * song's is the queue's own to apply (it waits for it, `searchPlaying`),
 * unless a newer command made another song playing meanwhile.
 */
const settleComingUp = (trackId: string, settled: Settlement | null): void => {
  if (settled === null || settled.kind === "failed") {
    if (settled !== null) retryLater();
    return;
  }
  const { entries, index } = queueState.get();
  if (!entries.some((entry, at) => at !== index && entry.trackId === trackId)) return;
  const song = readUnsearchedTrackId(trackId);
  if (settled.kind === "found") {
    // Found as an explicit song, it leaves the queue (Core's `reduceQueue` passes it over).
    if (song !== null && dontPlayExplicit() && settled.becomes.song.explicit) {
      void showToast(explicitSkipNotice(song.title));
    }
    void dispatch(trackId, ytTrackId(settled.becomes.song.videoId));
    return;
  }
  const step = song === null ? null : playingAnswerStep(song, settled, { chosen: false });
  if (step !== null && step.kind !== "play") void showToast(step.notice);
  void dispatch(trackId, null);
};

let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** Looks again once a failed search may be asked again. */
const retryLater = (): void => {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(lookAhead, PLAYING_SEARCH_RETRY_MS);
};

/**
 * Searches what's due for the queue as it is now; [nextDue] once the playing
 * song reached the crossfade's prefetch point.
 */
const lookAhead = (nextDue = false): void => {
  if (!ytMusicEnabled()) return;
  const state = queueState.get();
  const playing = currentEntry(state)?.trackId;
  const searching = { asking: new Set(asking.keys()), failedAt, nextDue };
  for (const { trackId } of playingSearches(state, searching, Date.now())) {
    // The playing song's search is the queue's own, which it waits for.
    if (trackId === playing) continue;
    void search(trackId).then((settled) => settleComingUp(trackId, settled));
  }
};

let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
/** The player entry playing, and whether its prefetch point was reached: asked once per play. */
let playingKey: string | null = null;
let prefetched = false;

/** Asks for the next song at the playing one's crossfade prefetch point, as playback goes on. */
const schedulePrefetch = (): void => {
  clearTimeout(prefetchTimer);
  const playback = playbackState.get();
  const key = playback.item?.id ?? null;
  if (key !== playingKey) {
    playingKey = key;
    prefetched = false;
  }
  if (key === null || prefetched || !playback.isPlaying) return;
  const at = crossfadePrefetchAt(crossfadeMs(), playback.durationMs);
  if (at === null) return;
  const due = (): void => {
    prefetched = true;
    lookAhead(true);
  };
  const waitMs = at - extrapolatePosition(playback, Date.now());
  if (waitMs <= 0) due();
  else prefetchTimer = setTimeout(due, waitMs);
};

let scheduled = false;

/** Looks ahead once a burst of queue changes has settled. */
const schedule = (): void => {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    lookAhead();
  }, 0);
};

let started = false;

/** Starts searching the queue's songs as they're about to play. Call it once per JS runtime. */
export const startPlayingSearches = (): void => {
  if (started) return;
  started = true;
  // The queue takes its playing song's answer; if another command came
  // meanwhile, the song is one coming up (or played) like the others.
  setPlayingSearcher((trackId) => {
    const searched = search(trackId);
    void searched.then((settled) => settleComingUp(trackId, settled));
    return searched;
  });
  queueState.subscribe(schedule);
  schedule();
  playbackState.subscribe(schedulePrefetch);
  schedulePrefetch();
};
