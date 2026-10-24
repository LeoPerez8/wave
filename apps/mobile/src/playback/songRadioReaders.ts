/** The radios a Magic Queue reads, one reader per session and radio (docs/spec.md, Magic Queue). */
import * as Effect from "effect/Effect";

import type { SongRadioPage, SongRadioSeed } from "./songRadioSession.ts";

/** One radio's reader, as `createSongRadioSession` makes it. */
export interface SongRadioReader<R> {
  readonly current: () => SongRadioPage | null;
  readonly read: (when: {
    readonly online: boolean;
    readonly low: boolean;
  }) => Effect.Effect<SongRadioPage | null, never, R>;
}

/** A radio with the page its reader holds (null before one arrives). */
export interface SongRadioRead {
  readonly seed: SongRadioSeed;
  readonly page: SongRadioPage | null;
}

/** How many sessions keep their readers: the latest ones, by last use. */
const SESSIONS = 20;

/**
 * Readers by session id, then by radio (`SongRadioSeed.id`), made by
 * [create] the first time a session asks for a radio. A radio drawn again
 * in the same session reuses its reader, so its live first page is read
 * once a session and its continuation only when low.
 */
export const createSongRadioReaders = <R>(create: (seed: SongRadioSeed) => SongRadioReader<R>) => {
  const sessions = new Map<string, Map<string, SongRadioReader<R>>>();
  const readersOf = (sessionId: string, seeds: readonly SongRadioSeed[]) => {
    const radios = sessions.get(sessionId) ?? new Map<string, SongRadioReader<R>>();
    sessions.delete(sessionId);
    sessions.set(sessionId, radios);
    if (sessions.size > SESSIONS) sessions.delete(sessions.keys().next().value!);
    return seeds.map((seed) => {
      let reader = radios.get(seed.id);
      if (reader === undefined) {
        reader = create(seed);
        radios.set(seed.id, reader);
      }
      return { seed, reader };
    });
  };
  return {
    /**
     * What [seeds]' radios hold for session [sessionId] now (a new reader its
     * cached page), in [seeds]' order, without reading.
     */
    current: (sessionId: string, seeds: readonly SongRadioSeed[]): SongRadioRead[] =>
      readersOf(sessionId, seeds).map(({ seed, reader }) => ({ seed, page: reader.current() })),
    /** Reads concurrently; a partial cache answers immediately while missing pages load. */
    read: (
      sessionId: string,
      seeds: readonly SongRadioSeed[],
      when: {
        readonly online: boolean;
        readonly low: boolean | ((seed: SongRadioSeed) => boolean);
      },
    ): Effect.Effect<SongRadioRead[], never, R> =>
      Effect.gen(function* () {
        const readers = readersOf(sessionId, seeds);
        const cached = readers.map(({ seed, reader }) => ({ seed, page: reader.current() }));
        const read = Effect.forEach(
          readers,
          ({ seed, reader }) =>
            Effect.map(
              reader.read({
                online: when.online,
                low: typeof when.low === "boolean" ? when.low : when.low(seed),
              }),
              (page) => ({ seed, page }),
            ),
          { concurrency: "unbounded" },
        );
        if (cached.some(({ page }) => page !== null) && cached.some(({ page }) => page === null)) {
          yield* Effect.forkDetach(read);
          return cached;
        }
        return yield* read;
      }),
  };
};
