/**
 * When Wave syncs with the account (docs/spec.md, "When it talks to the
 * service"). Kept free of Expo and React Native so its tests run it against
 * a hand-moved clock; `WaveSync` feeds it the app's events and runs the sync.
 */

/** How long a push waits after the last edit, so a run of edits goes up as one. */
export const PUSH_DELAY_MS = 3_000;
/** How long a play end waits for more before its batch goes up. */
export const PLAY_BATCH_DELAY_MS = 60_000;
/** A batch of play ends goes up this long after its first end at the latest. */
export const PLAY_BATCH_MAX_MS = 5 * 60_000;

/** Returning to the app syncs only when the last sync that finished is older than this. */
export const FOREGROUND_SYNC_INTERVAL_MS = 5 * 60_000;

/** The time, and timers on it. */
export interface SyncClock {
  readonly now: () => number;
  /** Runs [run] in [ms]; returns how to cancel it. */
  readonly after: (ms: number, run: () => void) => () => void;
}

export interface SyncTriggersInput {
  readonly clock: SyncClock;
  /**
   * Runs one sync; resolves whether it finished. [songs]: the song list may
   * have changed since the last sync that finished.
   */
  readonly run: (songs: boolean) => Promise<boolean>;
  /** Whether the first sync looks at the song list (the first after launch does). */
  readonly songsChanged?: boolean;
}

export interface SyncTriggers {
  /** A play started or ended. A start syncs nothing: its play goes up once it ends. */
  readonly played: (step: "started" | "ended") => void;
  /**
   * Something else changed here (a playlist, a star, a synced setting,
   * imported plays, the song list): it goes up a few seconds after the last
   * change. [songs]: the song list may have changed (a scan, a download).
   */
  readonly edited: (what: { readonly songs: boolean }) => void;
  /** Syncs now (Wave opened signed in, or signed in). */
  readonly now: () => void;
  /** Wave came back to the foreground: syncs if the last sync that finished is old enough. */
  readonly foreground: () => void;
  /** Signed out: the sync waiting is dropped. */
  readonly stop: () => void;
}

export const syncTriggers = ({
  clock,
  run,
  songsChanged: songsAtFirst = false,
}: SyncTriggersInput): SyncTriggers => {
  let running = false;
  /** Asked to sync while one was running: sync once more when it ends. */
  let again = false;
  /** The song list may have changed since the last sync that finished. */
  let songsChanged = songsAtFirst;
  /** The sync waiting to start, if any: a push of edits, or a batch of play ends. */
  let pending: { readonly kind: "push" | "plays"; readonly cancel: () => void } | null = null;
  /** When the last sync that finished started, if one did. */
  let finishedAt: number | null = null;
  /** When the first play end of the batch waiting came, if one waits. */
  let batchSince: number | null = null;

  const cancelPending = (): void => {
    pending?.cancel();
    pending = null;
  };

  const sync = (): void => {
    cancelPending();
    batchSince = null;
    if (running) {
      again = true;
      return;
    }
    running = true;
    again = false;
    const songs = songsChanged;
    songsChanged = false;
    const startedAt = clock.now();
    void run(songs)
      .then(
        (finished) => finished,
        () => false,
      )
      .then((finished) => {
        if (finished) finishedAt = startedAt;
        // The song list is looked at again next time.
        else if (songs) songsChanged = true;
        running = false;
        if (again) sync();
      });
  };

  const syncIn = (kind: "push" | "plays", ms: number): void => {
    cancelPending();
    pending = { kind, cancel: clock.after(ms, sync) };
  };

  return {
    played: (step) => {
      // A push waiting takes the plays with it, sooner.
      if (step === "started" || pending?.kind === "push") return;
      const now = clock.now();
      batchSince ??= now;
      // Each end pushes the batch back, up to its cap.
      syncIn("plays", Math.min(PLAY_BATCH_DELAY_MS, batchSince + PLAY_BATCH_MAX_MS - now));
    },
    edited: ({ songs }) => {
      if (songs) songsChanged = true;
      syncIn("push", PUSH_DELAY_MS);
    },
    now: sync,
    foreground: () => {
      // The sync running pulls already.
      if (running) return;
      if (finishedAt !== null && clock.now() - finishedAt < FOREGROUND_SYNC_INTERVAL_MS) return;
      sync();
    },
    stop: () => {
      cancelPending();
      batchSince = null;
      again = false;
      finishedAt = null;
    },
  };
};
