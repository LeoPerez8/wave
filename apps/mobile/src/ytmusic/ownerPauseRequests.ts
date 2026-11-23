/** The journal's Pause and Resume, every download's and one group's (#1474, #1475). */
export interface OwnerPauseNative {
  pauseAll(): Promise<void>;
  resumeAll(): Promise<void>;
  pauseGroup(key: string): Promise<void>;
  resumeGroup(key: string): Promise<void>;
}

/** The owner's Pause and Resume as they reach the journal. */
export interface OwnerPauseRequests {
  pauseAll(): void;
  resumeAll(): void;
  /** [key] is Core's `downloadGroupKey`. */
  pauseGroup(key: string): void;
  resumeGroup(key: string): void;
  /** Whether a Pause or Resume is still on its way to the journal: the rows keep the owner's value meanwhile. */
  pending(): boolean;
}

/**
 * The owner's Pause and Resume reach the journal at once, in the order pressed, on a chain of
 * their own: the request chain ([queue]) can wait on a playlist's songs or a free turn, and a
 * Pause behind it would leave the songs downloading. A request queued before a Pause can still
 * reach the journal after it, so the Pause runs again at its own place in [queue] and holds those
 * songs too, unless a Resume of the same songs came since. [landed] reads the journal again once
 * a call is over.
 */
export const createOwnerPauseRequests = ({
  native,
  queue,
  landed,
}: {
  native: OwnerPauseNative;
  queue: (work: () => Promise<void>) => void;
  landed: () => Promise<void>;
}): OwnerPauseRequests => {
  let chain: Promise<void> = Promise.resolve();
  let inFlight = 0;
  /** The latest Pause or Resume of every download, and of each group; a Resume of every download resumes the groups too. */
  let allLatest: object = {};
  const groupLatest = new Map<string, object>();

  const send = (call: () => Promise<void>, current: () => boolean = () => true): Promise<void> => {
    inFlight += 1;
    const done = chain
      .then(() => (current() ? call() : undefined))
      .catch(() => undefined)
      .then(() => {
        inFlight -= 1;
        return landed();
      })
      .catch(() => undefined);
    chain = done;
    return done;
  };

  return {
    pauseAll: () => {
      const pause = {};
      allLatest = pause;
      void send(() => native.pauseAll());
      queue(() =>
        send(
          () => native.pauseAll(),
          () => allLatest === pause,
        ),
      );
    },
    resumeAll: () => {
      allLatest = {};
      groupLatest.clear();
      void send(() => native.resumeAll());
    },
    pauseGroup: (key) => {
      const pause = {};
      groupLatest.set(key, pause);
      void send(() => native.pauseGroup(key));
      queue(() =>
        send(
          () => native.pauseGroup(key),
          () => groupLatest.get(key) === pause,
        ),
      );
    },
    resumeGroup: (key) => {
      groupLatest.set(key, {});
      void send(() => native.resumeGroup(key));
    },
    pending: () => inFlight > 0,
  };
};
