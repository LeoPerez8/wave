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
 * found song reaches the player before the overlap. While the song after the
 * playing one is still searched, or its search failed and is queued to be
 * asked again, the playback service knows (Core's `searchingAfter`), so a
 * crossfade waits for it at full volume rather than fade into the song after it.
 */
import {
  crossfadePrefetchAt,
  currentEntry,
  explicitSkipNotice,
  extrapolatePosition,
  playingAnswerStep,
  playingSearches,
  readUnsearchedTrackId,
  searchingAfter,
  ytTrackId,
  PLAYING_SEARCH_RETRY_MS,
  type UnsearchedSettlement,
  type YtAlbumSong,
} from "@wave/core";

import { appRuntime } from "@/library/runtime";
import { currentLocalisation } from "@/localisation/localisation";
import { WavePlayer } from "@/native/wavePlayer";
import { searchUnsearchedSong } from "@/library/unsearchedEntries";
import { showToast } from "@/overlay/toast";
import { crossfadeMs } from "@/settings/crossfade";
import { ytMusicEnabled } from "@/settings/ytMusic";

import { playbackState, positionState } from "./Player";
import { setPlayingSearcher } from "./playingSearch";
import { passOverNow, Queue, queueState } from "./Queue";
import { learnQueueTracks, toYtQueueTrack } from "./queueTracks";
import { cacheYtCoversInBackground } from "./ytQueueTracks";

type Settlement = UnsearchedSettlement<YtAlbumSong>;

/** The searches going on, by the song's queue id. */
const asking = new Map<string, Promise<Settlement | null>>();
/** When each song's last search failed, by its queue id: asked again only a while later. */
const failedAt = new Map<string, number>();

/** What the playback service was last told (`setSearchingAfter`). */
let toldSearchingAfter: string | null = null;

/** Tells the playback service which entry's next song is still searched, when that changed. */
const tellSearching = (): void => {
  // With YT Music off nothing searches the queue's songs, now or later.
  const after = ytMusicEnabled()
    ? searchingAfter(queueState.get(), { asking: new Set(asking.keys()), failedAt })
    : null;
  if (after === toldSearchingAfter) return;
  toldSearchingAfter = after;
  WavePlayer.setSearchingAfter(after).catch(() => {
    toldSearchingAfter = null;
  });
};

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
    // Found, the service hears it once the queue holds the song (lookAhead), not before: in
    // between, its next song would still be the one after.
    let found = false;
    try {
      const settled = await searchUnsearchedSong(song, "playing").catch((): Settlement => ({
        kind: "failed",
        reason: "failed",
      }));
      if (settled?.kind === "failed") failedAt.set(trackId, Date.now());
      else failedAt.delete(trackId);
      if (settled?.kind === "found") {
        found = true;
        const ytSong = settled.becomes.song;
        learnQueueTracks([toYtQueueTrack(ytSong, null)]);
        appRuntime.runFork(cacheYtCoversInBackground([ytSong]));
      }
      return settled;
    } finally {
      asking.delete(trackId);
      if (!found) tellSearching();
    }
  })();
  asking.set(trackId, searched);
  tellSearching();
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
  if (!entries.some((entry, at) => at !== index && entry.trackId === trackId)) {
    tellSearching();
    return;
  }
  const song = readUnsearchedTrackId(trackId);
  if (settled.kind === "found") {
    // Found as a song the queue passes over (explicit), it leaves the queue (Core's `reduceQueue`).
    const becomes = ytTrackId(settled.becomes.song.videoId);
    if (song !== null && passOverNow([toYtQueueTrack(settled.becomes.song, null)])(becomes)) {
      void showToast(explicitSkipNotice(song.title, currentLocalisation().strings));
    }
    void dispatch(trackId, becomes);
    return;
  }
  const step =
    song === null
      ? null
      : playingAnswerStep(song, settled, { chosen: false }, currentLocalisation().strings);
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
  if (!ytMusicEnabled()) {
    tellSearching();
    return;
  }
  const state = queueState.get();
  const playing = currentEntry(state)?.trackId;
  const searching = { asking: new Set(asking.keys()), failedAt, nextDue };
  for (const { trackId } of playingSearches(state, searching, Date.now())) {
    // The playing song's search is the queue's own, which it waits for.
    if (trackId === playing) continue;
    void search(trackId).then((settled) => settleComingUp(trackId, settled));
  }
  tellSearching();
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
  const position = positionState.get();
  const at = crossfadePrefetchAt(crossfadeMs(), position.durationMs);
  if (at === null) return;
  const due = (): void => {
    prefetched = true;
    lookAhead(true);
  };
  const waitMs = at - extrapolatePosition(position, Date.now());
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
