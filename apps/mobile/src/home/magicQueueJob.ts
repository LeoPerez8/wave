import {
  localDay,
  MAGIC_QUEUE_PICKS,
  magicQueuePicksSteps,
  type MagicQueuePicks,
  type TasteProfile,
  type RandomSource,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { runSteps } from "../lib/stepped.ts";
import { RECOMMENDATION_TIMEOUT } from "../lib/recommendationTimeout.ts";
import type { LibraryStore } from "../library/LibraryStore.ts";
import {
  readTasteLibrary,
  stableTasteSnapshot,
  type TasteLibrary,
} from "../playback/tasteDerivation.ts";

/** Standing picks need no whole-Library due check. The growth probe is only for short lists. */
export const homeMagicQueueDue = (
  visible: boolean,
  saved: MagicQueuePicks | null,
  shownIds: readonly string[],
  grows: boolean,
  now: number,
): boolean =>
  visible &&
  (saved === null ||
    saved.day !== localDay(now) ||
    saved.trackIds.length > MAGIC_QUEUE_PICKS ||
    saved.trackIds.some((id) => !shownIds.includes(id)) ||
    (saved.trackIds.length < MAGIC_QUEUE_PICKS && grows));

/** Due work returns a complete replacement; the caller keeps the previous saved choices until then. */
export const buildHomeMagicQueue = <R, E>(
  store: LibraryStore["Service"],
  saved: MagicQueuePicks | null,
  options: {
    readonly now: number;
    readonly random: RandomSource;
    readonly turn: Effect.Effect<void>;
    readonly taste: (library: TasteLibrary) => Effect.Effect<TasteProfile | null, E, R>;
    readonly refresh?: boolean;
  },
) =>
  stableTasteSnapshot(store, options.turn, (unchanged, discard) =>
    Effect.gen(function* () {
      const library = yield* readTasteLibrary(store, options.turn);
      const taste = yield* options.taste(library);
      // A profile read with a newer Library: pick again from that one, before drawing.
      if (!(yield* unchanged(library.revision))) return yield* discard();
      return yield* runSteps(
        magicQueuePicksSteps(
          saved,
          library.playable,
          { now: options.now, taste, random: options.random },
          options.refresh,
        ),
        options.turn,
      );
    }),
  );

/** The visible pick includes scheduler and derivation waits in its deadline. */
export const pickHomeMagicQueue = <R, E>(
  store: LibraryStore["Service"],
  saved: MagicQueuePicks | null,
  options: Parameters<typeof buildHomeMagicQueue<R, E>>[2],
  start: Effect.Effect<void> = Effect.void,
) =>
  start.pipe(
    Effect.andThen(buildHomeMagicQueue(store, saved, options)),
    Effect.timeout(RECOMMENDATION_TIMEOUT),
  );
