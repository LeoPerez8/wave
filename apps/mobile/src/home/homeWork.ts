/**
 * Home's build runs only while Home is in sight (#1351): the mixes, the
 * recommendation snapshot they read and the Magic Queue carousel's seeds take
 * their turns through `homeWork.turn`, which waits while Home is out of sight
 * (another tab or a pushed screen shown, Now Playing over it, Wave in the
 * background). Work already in a slice finishes it; the next one waits for
 * Home to come back. Someone off Home who waits for that work (a Magic Queue
 * started from Search waiting for the snapshot) opens the gate while they
 * wait (`wanted`). While Home's screen waits to draw its first content
 * (`waitForContent`), its own work waits too, so none of it competes with
 * Home's first rows (#1487). Kept free of React Native for the Node tests.
 */
import type { ScreenSight } from "@wave/client/sight";
import * as Effect from "effect/Effect";

export const createHomeWork = () => {
  let sight: ScreenSight | null = null;
  let stopSight: (() => void) | null = null;
  /** Fibers off Home waiting for Home's work. */
  let wanted = 0;
  /** Home screens still waiting to draw their first content. */
  let drawing = 0;
  const waiting = new Set<() => void>();
  const open = (): boolean => wanted > 0 || (drawing === 0 && sight?.visible() === true);
  const wake = (): void => {
    if (!open()) return;
    const ready = [...waiting];
    waiting.clear();
    for (const resume of ready) resume();
  };
  const turn: Effect.Effect<void> = Effect.suspend(() =>
    open()
      ? Effect.void
      : Effect.callback<void>((resume) => {
          const ready = () => resume(Effect.void);
          waiting.add(ready);
          return Effect.sync(() => {
            waiting.delete(ready);
          });
        }),
  );
  return {
    /** Whether Home's work may take a turn now. */
    open,
    /** Before each of Home's slices and reads: now while open, else once Home is back. */
    turn,
    /** Home's screen reports its sight while mounted; returns how to stop. */
    follow: (next: ScreenSight): (() => void) => {
      stopSight?.();
      sight = next;
      const stop = next.subscribe(wake);
      stopSight = stop;
      wake();
      return () => {
        if (sight !== next) return;
        stop();
        sight = null;
        stopSight = null;
      };
    },
    /**
     * Holds Home's work while Home's screen draws its first content; returns
     * how to say it's drawn (or that the screen left first). Once is enough.
     */
    waitForContent: (): (() => void) => {
      drawing++;
      let done = false;
      return () => {
        if (done) return;
        done = true;
        drawing--;
        wake();
      };
    },
    /** [effect], with Home's work open while it runs: for those off Home who wait for it. */
    wanted: <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          wanted++;
          wake();
        }),
        () => effect,
        () =>
          Effect.sync(() => {
            wanted--;
          }),
      ),
  };
};

/** The app's one gate for Home's work. */
export const homeWork = createHomeWork();

/** [turn] (a frame's or a free turn), then Home's gate, so no slice starts off Home. */
export const homeTurnOf = <R>(turn: Effect.Effect<void, never, R>): Effect.Effect<void, never, R> =>
  Effect.andThen(turn, homeWork.turn);
