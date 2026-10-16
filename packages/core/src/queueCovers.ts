/**
 * YT Music covers cached after a play has started land in the queue's tracks
 * (Up Next's thumbnails, Now Playing's tint). This decides what a batch of
 * them changes, and when the app hands a batch over: one copy of the queue's
 * tracks and one notification per batch, not per cover.
 */

import type { ArtworkPalette } from "./palette.ts";

/** A YT Music song's cover, cached on the phone. */
export interface QueueCover {
  readonly artworkPath: string;
  readonly thumbPath: string;
  readonly palette: ArtworkPalette;
}

/** The parts of a queued track a cover fills in. */
interface CoveredTrack {
  readonly artworkPath: string | null;
  readonly thumbPath: string | null;
  readonly palette?: ArtworkPalette | null;
}

/**
 * [tracks] with [covers] (by track id) filled in. A cover whose track has
 * left the queue meanwhile is dropped, so it doesn't bring the track back.
 * [tracks] itself when no cover is for a queued track.
 */
export const withQueueCovers = <T extends CoveredTrack>(
  tracks: ReadonlyMap<string, T>,
  covers: ReadonlyMap<string, QueueCover>,
): ReadonlyMap<string, T> => {
  let next: Map<string, T> | null = null;
  for (const [id, cover] of covers) {
    const track = tracks.get(id);
    if (track === undefined) continue;
    next ??= new Map(tracks);
    next.set(id, { ...track, ...cover });
  }
  return next ?? tracks;
};

/**
 * How long a landed cover waits for others before the batch is handed over,
 * in ms. Up Next re-renders its rows at most this often while covers come in;
 * a row's thumbnail shows at most this late.
 */
export const QUEUE_COVER_FLUSH_MS = 500;

export interface QueueCoverBatcher {
  /** [cover] has landed for the track [trackId]. */
  readonly add: (trackId: string, cover: QueueCover) => void;
  /** Hands over what waits now (the caching is over). */
  readonly flush: () => void;
}

export interface QueueCoverBatcherOptions {
  /** Runs [run] in [ms]; returns how to cancel it. */
  readonly schedule: (ms: number, run: () => void) => () => void;
  /** Whether [trackId] is the playing track: its cover is handed over at once, for Now Playing. */
  readonly playing: (trackId: string) => boolean;
  /** Takes a batch of covers by track id (the app's `withQueueCovers` on its queued tracks). */
  readonly apply: (covers: ReadonlyMap<string, QueueCover>) => void;
}

/**
 * Collects landed covers and hands them over in batches: those landing
 * within `QUEUE_COVER_FLUSH_MS` of the first one waiting go together, and the
 * playing track's goes at once, taking whatever waits along.
 */
export const createQueueCoverBatcher = ({
  schedule,
  playing,
  apply,
}: QueueCoverBatcherOptions): QueueCoverBatcher => {
  let waiting = new Map<string, QueueCover>();
  let cancel: (() => void) | null = null;

  const flush = (): void => {
    cancel?.();
    cancel = null;
    if (waiting.size === 0) return;
    const batch = waiting;
    waiting = new Map();
    apply(batch);
  };

  return {
    add: (trackId, cover) => {
      waiting.set(trackId, cover);
      if (playing(trackId)) flush();
      else cancel ??= schedule(QUEUE_COVER_FLUSH_MS, flush);
    },
    flush,
  };
};
