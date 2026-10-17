/**
 * The YouTube Music search allowance every automatic search shares
 * (docs/spec.md, YT Music, "Search allowance"): a link import's searches, a
 * download's, Discover mixes'. Core decides who goes next and what the log
 * says about a wait (`searchTurns`, `searchWaitLine`); this keeps the
 * allowance, wakes the searches whose turn came, and logs waits and failed
 * searches. A search typed in Search doesn't come here.
 */
import {
  readSearchAllowance,
  searchFailedLine,
  searchTurnWanted,
  searchTurnWithdrawn,
  searchTurns,
  searchWaitLine,
  writeSearchAllowance,
  type SearchAllowance,
  type SearchAsker,
  type SearchWait,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { persistedSetting } from "@/lib/persistedSetting";
import { appLog } from "@/log/appLog";

import type { YtMusicError } from "./YtMusic";

/** The app log's tag for the allowance and failed searches; native code logs its side as `WaveYtMusic`. */
const TAG = "WaveSearch";

/**
 * The searches asked lately, kept so a restart doesn't start a fresh
 * allowance. The key is the one Spotify imports kept theirs under before
 * every search shared it, so an update keeps the window it had.
 */
const kept = persistedSetting<SearchAllowance>({
  key: "spotifySearches",
  read: readSearchAllowance,
  write: (value) => (value.searchesAt.length === 0 ? null : writeSearchAllowance(value)),
  persistDelayMs: 1000,
  persistMaxDelayMs: 1000,
});

/** The allowance now, with the searches waiting (which aren't kept). */
let allowance: SearchAllowance | null = null;
const current = (): SearchAllowance => (allowance ??= kept.get());

let lastId = 0;
/** The searches waiting, by id: each resolves true once its turn comes. */
const turns = new Map<number, (granted: boolean) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
const waitListeners = new Set<(wait: SearchWait) => void>();

/** Gives the waiting searches whose turn it is theirs, logs waits started or ended, and sleeps until the next. */
const decide = (): void => {
  clearTimeout(timer);
  timer = undefined;
  const now = Date.now();
  const decided = searchTurns(current(), now);
  allowance = decided.allowance;
  if (decided.go.length > 0) kept.set(decided.allowance);
  for (const wait of decided.waits) {
    appLog("info", TAG, searchWaitLine(wait));
    for (const listener of waitListeners) listener(wait);
  }
  for (const id of decided.go) {
    turns.get(id)?.(true);
    turns.delete(id);
  }
  if (decided.nextAt !== null) timer = setTimeout(decide, Math.max(0, decided.nextAt - now));
};

/**
 * Waits for [asker]'s turn in the allowance; true once it comes (the
 * search then counts as asked), false when [signal] gave it up first.
 */
export const searchTurn = (asker: SearchAsker, signal?: AbortSignal): Promise<boolean> => {
  if (signal?.aborted === true) return Promise.resolve(false);
  lastId += 1;
  const id = lastId;
  return new Promise((resolve) => {
    const giveUp = (): void => {
      if (!turns.delete(id)) return;
      allowance = searchTurnWithdrawn(current(), id);
      resolve(false);
      decide();
    };
    turns.set(id, (granted) => {
      signal?.removeEventListener("abort", giveUp);
      resolve(granted);
    });
    signal?.addEventListener("abort", giveUp, { once: true });
    allowance = searchTurnWanted(current(), { id, asker }, Date.now());
    decide();
  });
};

/** Hears each wait for the allowance that starts or ends (an import adds up its own). */
export const onSearchWait = (listener: (wait: SearchWait) => void): (() => void) => {
  waitListeners.add(listener);
  return () => waitListeners.delete(listener);
};

/** The searches asked lately, for an import's time left. */
export const searchesAsked = (): SearchAllowance => current();

/** Notes in the app log that [asker]'s search [query] failed ([reason]); native code logs what it saw. */
export const logSearchFailure = (
  asker: SearchAsker,
  query: string,
  reason: YtMusicError["reason"],
): void => appLog("warn", TAG, searchFailedLine(asker, query, reason));

/**
 * [search] for [query] once [asker]'s turn in the allowance comes; its
 * failure is logged. Interrupted while it waits, the turn is given up.
 */
export const withSearchTurn = <A, R>(
  asker: SearchAsker,
  query: string,
  search: Effect.Effect<A, YtMusicError, R>,
): Effect.Effect<A, YtMusicError, R> =>
  Effect.promise((signal) => searchTurn(asker, signal)).pipe(
    Effect.andThen(search),
    Effect.tapError((error) => Effect.sync(() => logSearchFailure(asker, query, error.reason))),
  );
