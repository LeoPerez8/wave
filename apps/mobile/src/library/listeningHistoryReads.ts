import {
  startingAt,
  type ListeningHistoryCursor,
  type ListeningHistoryPage,
} from "./db/listeningHistory.ts";

/**
 * The next page (`more`), the one above a moment's (`newer`), the newest one
 * again (`head`), or every page shown (`refresh`).
 */
export type ListeningHistoryRead = "more" | "newer" | "head" | "refresh";

/** A page older than a cursor (the newest without one), newer than one, or around a play. */
export type ListeningHistoryFrom =
  | { readonly before: ListeningHistoryCursor | undefined }
  | { readonly after: ListeningHistoryCursor }
  | { readonly around: number };

export interface ListeningHistoryReads {
  /** Reads now, or once the read going on ends. */
  readonly request: (read: ListeningHistoryRead) => void;
  /** Reads after `delay` ms, folded with the other reads scheduled meanwhile. */
  readonly schedule: (read: ListeningHistoryRead, delay: number) => void;
  /** Drops what's scheduled; reads going on no longer report. */
  readonly stop: () => void;
}

/**
 * History's page reads, one at a time, starting from the [initial] pages
 * shown: a head read merges the newest page into them, `more` appends the
 * next one, `refresh` reads again as many rows as are shown. Opened at the
 * play [around] (Go to This Moment), the first refresh reads the plays around
 * it; until `newer` pages reach the newest play, a head read has nothing to
 * join and a refresh reads from the top row shown.
 */
export const listeningHistoryReads = ({
  initial,
  around,
  readPage,
  onPage,
  onLoading,
  onError,
}: {
  readonly initial: ListeningHistoryPage;
  readonly around?: number | undefined;
  readonly readPage: (from: ListeningHistoryFrom) => Promise<ListeningHistoryPage>;
  readonly onPage: (page: ListeningHistoryPage) => void;
  readonly onLoading: (loading: boolean) => void;
  readonly onError: (error: boolean) => void;
}): ListeningHistoryReads => {
  let shown = initial;
  let active = true;
  let busy = false;
  let pending: ListeningHistoryRead | null = null;
  /** A page asked for during another read: the list's end won't ask again. */
  let more = false;
  /** The same for the page above a moment's, which the list's start asks for. */
  let newer = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async (read: ListeningHistoryRead): Promise<void> => {
    if (!active) return;
    if (busy) {
      if (read === "more") more = true;
      else if (read === "newer") newer = true;
      else pending = pending === "refresh" ? pending : read;
      return;
    }
    const previous = shown;
    const top = previous.rows[0];
    let from: ListeningHistoryFrom;
    if (read === "more") {
      if (previous.next === null) return;
      from = { before: previous.next };
    } else if (read === "newer") {
      if (previous.newer === null) return;
      from = { after: previous.newer };
    } else if (previous.newer !== null) {
      // Below the newest play: no head to join, and a refresh keeps the rows from the top one.
      if (read === "head" || top === undefined) return;
      from = { before: startingAt(top) };
    } else
      from =
        read === "refresh" && top === undefined && around !== undefined
          ? { around }
          : { before: undefined };
    busy = true;
    onLoading(true);
    onError(false);
    try {
      let result = await readPage(from);
      if (read === "refresh" && top !== undefined) {
        // Yield between pages when a Library edit revalidates a long, already opened list.
        while (result.next !== null && result.rows.length < previous.rows.length) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (!active) return;
          const next = await readPage({ before: result.next });
          result = { rows: [...result.rows, ...next.rows], next: next.next, newer: result.newer };
        }
        result = { ...result, newer: previous.newer };
      } else if (
        read === "more" ||
        read === "newer" ||
        result.rows.some((row) => previous.rows.some((old) => old.id === row.id))
      ) {
        // Keep the previous boundary and overlapping head rows: inserting a new play cannot leave a gap.
        const byId = new Map(previous.rows.map((row) => [row.id, row]));
        for (const row of result.rows) byId.set(row.id, row);
        result = {
          // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
          rows: [...byId.values()].sort((a, b) => b.startedAt - a.startedAt || b.id - a.id),
          next: read === "more" ? result.next : previous.next,
          newer: read === "newer" ? result.newer : previous.newer,
        };
      }
      if (active) {
        shown = result;
        onPage(result);
      }
    } catch {
      if (active) onError(true);
    } finally {
      busy = false;
      if (active) {
        onLoading(false);
        if (more) {
          more = false;
          void run("more");
        } else if (newer) {
          newer = false;
          void run("newer");
        } else if (pending !== null) {
          const next = pending;
          pending = null;
          clearTimeout(timer);
          timer = undefined;
          void run(next);
        }
      }
    }
  };
  return {
    request: (read) => void run(read),
    schedule: (read, delay) => {
      pending = pending === "refresh" ? pending : read;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        const next = pending;
        pending = null;
        if (next !== null) void run(next);
      }, delay);
    },
    stop: () => {
      active = false;
      clearTimeout(timer);
    },
  };
};
