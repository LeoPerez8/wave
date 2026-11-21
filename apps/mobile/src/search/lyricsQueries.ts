/** How long typing pauses before Lyrics reads its index for the query. */
export const LYRICS_TYPING_PAUSE_MS = 250;

export type LyricsQueries = {
  /** A keystroke: the query is read once typing pauses. */
  readonly type: (query: string) => void;
  /** The field's submit: the query is read at once. */
  readonly submit: (query: string) => void;
  /** The index changed: the settled query is read again. */
  readonly refresh: () => void;
  readonly dispose: () => void;
};

/**
 * When Lyrics' index is read for what's typed (#1354). Songs, albums and artists answer each
 * keystroke from Search's in-memory index; lyrics need a word-index query, so they wait for a
 * pause in typing (or a submit). Only the newest read answers: an older one finishing later is
 * dropped, so answers never arrive out of order.
 */
export const lyricsQueries = <A>({
  read,
  answer,
  fail = () => {},
  clear = () => {},
  pauseMs = LYRICS_TYPING_PAUSE_MS,
}: {
  readonly read: (query: string) => Promise<A>;
  readonly answer: (query: string, answer: A) => void;
  readonly fail?: (query: string) => void;
  /** The field emptied: whatever was answered is cleared. */
  readonly clear?: () => void;
  readonly pauseMs?: number;
}): LyricsQueries => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Bumped by every query and read, so a read only answers while it is the newest.
  let generation = 0;
  let settled: string | null = null;
  let disposed = false;

  const stopWaiting = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const run = (query: string) => {
    stopWaiting();
    settled = query;
    const mine = ++generation;
    read(query).then(
      (value) => {
        if (!disposed && mine === generation) answer(query, value);
      },
      () => {
        if (!disposed && mine === generation) fail(query);
      },
    );
  };

  return {
    type: (query) => {
      if (disposed) return;
      const trimmed = query.trim();
      // The same words again (a trailing space): the read already asked for them stands.
      if (trimmed !== "" && trimmed === settled && timer === null) return;
      stopWaiting();
      generation++;
      settled = null;
      if (trimmed === "") return clear();
      timer = setTimeout(() => run(trimmed), pauseMs);
    },
    submit: (query) => {
      if (disposed) return;
      const trimmed = query.trim();
      if (trimmed === "") return;
      if (trimmed === settled && timer === null) return;
      run(trimmed);
    },
    refresh: () => {
      if (disposed || settled === null || timer !== null) return;
      run(settled);
    },
    dispose: () => {
      disposed = true;
      stopWaiting();
    },
  };
};
