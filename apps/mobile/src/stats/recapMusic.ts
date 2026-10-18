import { recapSong } from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useRef, useState } from "react";

import { songHasFile } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { Player, playbackState } from "@/playback/Player";
import { Queue, toQueueTrack, type QueueLoan } from "@/playback/Queue";

import type { LoadedRecap } from "./Stats";

type MusicEffect = Effect.Effect<void, unknown, Player | Queue>;

/** Runs [effect] after the steps already in [steps], so the player's steps keep the order they were asked in. */
const runAfter = (steps: { current: Promise<void> }, effect: MusicEffect): void => {
  steps.current = steps.current.then(() => appRuntime.runPromise(effect)).catch(() => {});
};

/**
 * A Recap's music while its stories show (Core's `recapSong`): with nothing
 * playing as they open, the song slide `index` features, else the Recap's #1,
 * plays in place of the queue; holding a slide (`paused`) pauses it. Leaving
 * gives the queue back as it was, paused where it was. With something
 * playing, it's left alone.
 */
export function useRecapMusic(
  recap: LoadedRecap | null | undefined,
  index: number,
  paused: boolean,
): void {
  const [playingBefore] = useState(() => playbackState.get().playWhenReady);
  const loan = useRef<QueueLoan | null>(null);
  const steps = useRef<Promise<void>>(Promise.resolve());

  const row = useMemo(() => {
    const song =
      recap === undefined || recap === null
        ? null
        : recapSong(recap.slides, index, { playingBefore });
    return song !== null && songHasFile(song.item) ? song.item : null;
  }, [recap, index, playingBefore]);

  // Whether the stories are held (or Share is open) as each step runs.
  const held = useRef(paused);

  // A new slide's song takes over; the same song goes on playing.
  const played = useRef<number | null>(null);
  useEffect(() => {
    if (row === null || row.id === played.current) return;
    played.current = row.id;
    runAfter(
      steps,
      Effect.gen(function* () {
        loan.current ??= yield* (yield* Queue).borrow;
        yield* loan.current.play(toQueueTrack(row));
        // Held before the song could start (while the Recap loaded): it waits, paused.
        if (held.current) yield* (yield* Player).pause;
      }),
    );
  }, [row]);

  // Holding a slide pauses the music, letting go resumes it.
  useEffect(() => {
    if (held.current === paused) return;
    held.current = paused;
    runAfter(
      steps,
      Effect.gen(function* () {
        if (loan.current === null) return;
        const player = yield* Player;
        yield* paused ? player.pause : player.play;
      }),
    );
  }, [paused]);

  // Leaving gives the queue back.
  useEffect(
    () => () =>
      runAfter(
        steps,
        Effect.gen(function* () {
          const lent = loan.current;
          loan.current = null;
          if (lent !== null) yield* lent.giveBack;
        }),
      ),
    [],
  );
}
