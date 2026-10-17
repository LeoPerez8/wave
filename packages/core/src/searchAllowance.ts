/**
 * The allowance every automatic YouTube Music search shares (docs/spec.md,
 * YT Music, "Search allowance"): at most `SEARCH_ALLOWANCE` searches in any
 * `SEARCH_WINDOW_MS`, kept while Wave is closed, who goes next when several
 * wait for it, and what the app log says about a wait. A search typed in
 * Search is outside it.
 */

/** Who asks an automatic YouTube Music search. */
export type SearchAsker = "playing" | "download" | "tryAgain" | "discover" | "fill";

/**
 * At most this many searches in any `SEARCH_WINDOW_MS`. YouTube Music began
 * refusing some after about 2,300 searches in 15 minutes (measured
 * 2026-10-14), and 1,000 at a time never drew a refusal.
 */
export const SEARCH_ALLOWANCE = 1000;
export const SEARCH_WINDOW_MS = 15 * 60_000;

/** How each asker takes its turn, and how the log names it. */
interface AskerTurn {
  /** A lower rank goes first. */
  readonly rank: number;
  /** It takes no search while the window holds this many. */
  readonly most: number;
  /** As the log names it, mid-sentence. */
  readonly name: string;
}

/** Where each asker stands. A new one is one more row. */
const ASKERS: Readonly<Record<SearchAsker, AskerTurn>> = {
  playing: { rank: 0, most: SEARCH_ALLOWANCE, name: "the song about to play" },
  download: { rank: 1, most: SEARCH_ALLOWANCE, name: "a download" },
  // A playlist's unavailable entries searched again: downloads' priority, named apart in the log.
  tryAgain: { rank: 1, most: SEARCH_ALLOWANCE, name: "Try Again" },
  discover: { rank: 2, most: SEARCH_ALLOWANCE, name: "a Discover mix" },
  // Unsearched entries searched while Wave runs: last, and never the 200 kept for playing and downloads.
  fill: { rank: 3, most: 800, name: "the background fill" },
};

/** The order askers are named in when several do something at once: by rank. */
// oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
const ASKER_ORDER = (Object.keys(ASKERS) as SearchAsker[]).sort(
  (a, b) => ASKERS[a].rank - ASKERS[b].rank,
);

/** A search waiting for its turn. */
export interface SearchWaiting {
  /** The caller's own id for it, unique among those waiting. */
  readonly id: number;
  readonly asker: SearchAsker;
  /** When it asked for its turn (ms). */
  readonly since: number;
}

/** An asker held back by the window: since when, and how many searches the window held then. */
interface OpenWait {
  readonly since: number;
  readonly held: number;
}

/** The searches asked lately and those waiting for their turn. */
export interface SearchAllowance {
  /** When each search in the window was asked (ms), oldest first. */
  readonly searchesAt: readonly number[];
  /** The searches waiting for their turn, in the order they asked. */
  readonly waiting: readonly SearchWaiting[];
  /** The askers held back now, each logged once as its wait starts and once as it ends. */
  readonly waits: Readonly<Partial<Record<SearchAsker, OpenWait>>>;
}

/** No search asked yet, none waiting. */
export const NO_SEARCHES: SearchAllowance = { searchesAt: [], waiting: [], waits: {} };

/** The searches still in the window at [now], oldest first. */
const recent = (searchesAt: readonly number[], now: number): number[] =>
  searchesAt.filter((at) => at > now - SEARCH_WINDOW_MS);

/** [allowance] with a search of [asker]'s, [id], waiting for its turn from [now]. */
export const searchTurnWanted = (
  allowance: SearchAllowance,
  { id, asker }: { readonly id: number; readonly asker: SearchAsker },
  now: number,
): SearchAllowance => ({
  ...allowance,
  waiting: [...allowance.waiting, { id, asker, since: now }],
});

/** [allowance] without the waiting search [id]: given up before its turn, it spends nothing. */
export const searchTurnWithdrawn = (allowance: SearchAllowance, id: number): SearchAllowance =>
  allowance.waiting.some((search) => search.id === id)
    ? { ...allowance, waiting: allowance.waiting.filter((search) => search.id !== id) }
    : allowance;

/** A wait for the allowance that started or ended, for the app log (`searchWaitLine`). */
export type SearchWait =
  | {
      readonly kind: "started";
      readonly asker: SearchAsker;
      readonly at: number;
      /** How many searches the window held. */
      readonly held: number;
      /** When the window has room for the asker again, at the earliest (ms). */
      readonly freeAt: number;
    }
  | {
      readonly kind: "ended";
      readonly asker: SearchAsker;
      readonly since: number;
      readonly at: number;
      /** How many searches the window held when it started. */
      readonly held: number;
    };

/** What `searchTurns` decided. */
export interface SearchTurns {
  readonly allowance: SearchAllowance;
  /** The searches whose turn it is now, in the order they go; each counts as asked now. */
  readonly go: readonly number[];
  /** When the next search still waiting may go at the earliest (ms); null when none waits. */
  readonly nextAt: number | null;
  /** The waits that started or ended now, the askers in rank order. */
  readonly waits: readonly SearchWait[];
}

/** The line of waiting searches in the order they go: by rank, then as they asked. */
const inTurn = (waiting: readonly SearchWaiting[]): SearchWaiting[] =>
  waiting
    .map((search, order) => ({ search, order }))
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    .sort((a, b) => ASKERS[a.search.asker].rank - ASKERS[b.search.asker].rank || a.order - b.order)
    .map(({ search }) => search);

/** When a window holding [searchesAt] (oldest first) holds fewer than [most] again (ms). */
const freeAt = (searchesAt: readonly number[], most: number, now: number): number => {
  const leaving = searchesAt[searchesAt.length - most];
  return leaving === undefined ? now : leaving + SEARCH_WINDOW_MS;
};

/**
 * Who goes now, given [allowance] at [now]: the waiting searches, highest
 * rank first and then as they asked, while the window holds fewer than each
 * one's asker may fill. A search that can't go holds back every one after
 * it, so a lower rank never takes a search a higher one is waiting for. An
 * asker held back starts a wait; one no longer held back (its searches went,
 * or were given up) ends it.
 */
export const searchTurns = (allowance: SearchAllowance, now: number): SearchTurns => {
  const searchesAt = recent(allowance.searchesAt, now);
  const go: number[] = [];
  const line = inTurn(allowance.waiting);
  let next = 0;
  for (; next < line.length; next += 1) {
    const search = line[next];
    if (search === undefined || searchesAt.length >= ASKERS[search.asker].most) break;
    go.push(search.id);
    searchesAt.push(now);
  }
  const heldBack = new Set(line.slice(next).map(({ asker }) => asker));
  const waits: Partial<Record<SearchAsker, OpenWait>> = {};
  const changed: SearchWait[] = [];
  for (const asker of ASKER_ORDER) {
    const open = allowance.waits[asker];
    if (heldBack.has(asker)) {
      waits[asker] = open ?? { since: now, held: searchesAt.length };
      if (open === undefined) {
        const at = freeAt(searchesAt, ASKERS[asker].most, now);
        changed.push({ kind: "started", asker, at: now, held: searchesAt.length, freeAt: at });
      }
    } else if (open !== undefined) {
      changed.push({ kind: "ended", asker, since: open.since, at: now, held: open.held });
    }
  }
  const blocked = line[next];
  const gone = new Set(go);
  return {
    allowance: {
      searchesAt,
      waiting: allowance.waiting.filter(({ id }) => !gone.has(id)),
      waits,
    },
    go,
    nextAt: blocked === undefined ? null : freeAt(searchesAt, ASKERS[blocked.asker].most, now),
    waits: changed,
  };
};

// ---------------------------------------------------------------------------
// The app log

/** [ms] as a time of day in UTC, as the log's own times are: "13:14:00". */
const clock = (ms: number): string => new Date(ms).toISOString().slice(11, 19);

/** How long [ms] lasted, for the log: "42 s", "13 min 59 s", "14 min", "2 h 5 min". */
export const logDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return seconds % 60 === 0 ? `${minutes} min` : `${minutes} min ${seconds % 60} s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
};

/** "1,000 searches in the last 15 min". */
const windowHeld = (held: number): string => {
  const searches = `${held.toLocaleString("en")} ${held === 1 ? "search" : "searches"}`;
  return `${searches} in the last ${SEARCH_WINDOW_MS / 60_000} min`;
};

/** The app log's line for [wait]: who waited, from when until when, and what the window held. */
export const searchWaitLine = (wait: SearchWait): string => {
  const { name, most } = ASKERS[wait.asker];
  const who = name.charAt(0).toUpperCase() + name.slice(1);
  if (wait.kind === "started") {
    const limit =
      most === SEARCH_ALLOWANCE ? "the most it allows" : `the most it lets ${name} take`;
    return `${who} waits for the YouTube Music search allowance: ${windowHeld(wait.held)}, ${limit}; the next is free at ${clock(wait.freeAt)} UTC`;
  }
  return `${who} waited for the YouTube Music search allowance from ${clock(wait.since)} to ${clock(wait.at)} UTC (${logDuration(wait.at - wait.since)}, with ${windowHeld(wait.held)})`;
};

/** Why a YouTube Music search got no answer, as the app sees it. */
export type SearchFailure = "offline" | "failed" | "disabled";

const FAILURE_NAMES: Readonly<Record<SearchFailure, string>> = {
  offline: "offline",
  disabled: "YT Music off",
  failed: "failed",
};

/**
 * The app log's line for [asker]'s search [query] that failed for [reason].
 * Native code logs what it saw of the same failure (the HTTP status, or the
 * exception) on a line of its own.
 */
export const searchFailedLine = (
  asker: SearchAsker,
  query: string,
  reason: SearchFailure,
): string =>
  `A YouTube Music search for ${ASKERS[asker].name} failed (${FAILURE_NAMES[reason]}): "${query}"`;

// ---------------------------------------------------------------------------
// Kept while Wave is closed

/**
 * [allowance] as kept until Wave starts again (`readSearchAllowance`): the
 * searches asked, not those waiting, which go with the process.
 */
export const writeSearchAllowance = (allowance: SearchAllowance): string =>
  JSON.stringify({ searchesAt: allowance.searchesAt.slice(-SEARCH_ALLOWANCE) });

/**
 * The searches kept as [stored] (`writeSearchAllowance`, or the same shape
 * Spotify imports kept before every search shared the allowance); none
 * waiting, and none when nothing readable is kept.
 */
export const readSearchAllowance = (stored: string | null): SearchAllowance => {
  if (stored === null) return NO_SEARCHES;
  try {
    const value: unknown = JSON.parse(stored);
    const searchesAt =
      typeof value === "object" && value !== null && "searchesAt" in value
        ? value.searchesAt
        : null;
    if (!Array.isArray(searchesAt)) return NO_SEARCHES;
    const times = searchesAt.filter((at): at is number => Number.isFinite(at));
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    const sorted = times.sort((a, b) => a - b).slice(-SEARCH_ALLOWANCE);
    return { ...NO_SEARCHES, searchesAt: sorted };
  } catch {
    return NO_SEARCHES;
  }
};
