import type { RecognizeCard, RecognizeTileNotice, RecognizeTrack, YtSong } from "@wave/core";

import { startRecognizeSession, type RecognizeDeps } from "./recognizeSession.ts";

/** The tile's half of native (`recognize/RecognizeTileRun.kt`, `RecognizeListeningService.kt`). */
export interface RecognizeTileNative {
  /** Takes the tap waiting for JS; 0 when none is. */
  readonly take: () => number;
  /** A tap is waiting; returns the unsubscribe. */
  readonly onRequested: (listener: () => void) => () => void;
  /** Tap [tap]'s session was cancelled from the tile or its notification. */
  readonly onCancelled: (listener: (tap: number) => void) => () => void;
  /** Tap [tap] stopped listening: its ongoing notification goes and the tile turns off. */
  readonly listeningEnded: (tap: number) => void;
  /** No session has work left, so native lets go of the service holding JS. */
  readonly finished: () => void;
  readonly notify: (notice: RecognizeTileNotice) => void;
}

/**
 * Follows the tile's taps. Each runs the card's session (Core decides everything in it)
 * with no card: its capture doesn't depend on Wave's screen, so Wave always counts as
 * foreground for Core's clock, and what it ends on goes to [notice]'s notification.
 * Returns the cancel of a session still listening, for a card session taking over the
 * capture, and the unsubscribe.
 */
export const followRecognizeTile = <L extends RecognizeTrack, S extends YtSong>(
  tile: RecognizeTileNative,
  deps: RecognizeDeps<L, S>,
  notice: (card: RecognizeCard<L, S>) => RecognizeTileNotice | null,
): { readonly cancel: () => void; readonly stop: () => void } => {
  let listening: { readonly tap: number; readonly cancel: () => void } | null = null;
  let running = 0;

  const start = (tap: number): void => {
    let ended = false;
    const end = (): void => {
      if (ended) return;
      ended = true;
      if (listening?.tap === tap) listening = null;
      tile.listeningEnded(tap);
    };
    running++;
    const run = startRecognizeSession(
      { ...deps, foreground: () => true },
      "auto",
      (card) => {
        if (card.kind === "listening") return;
        end();
        const shown = notice(card);
        if (shown !== null) tile.notify(shown);
      },
      () => undefined,
    );
    listening = { tap, cancel: run.cancel };
    void run.done.then(() => {
      end();
      if (--running === 0) tile.finished();
    });
  };

  const receive = (): void => {
    const tap = tile.take();
    if (tap !== 0) start(tap);
  };

  const stops = [
    tile.onRequested(receive),
    tile.onCancelled((tap) => {
      if (listening?.tap === tap) listening.cancel();
    }),
  ];
  receive();
  return {
    cancel: () => listening?.cancel(),
    stop: () => {
      for (const stop of stops) stop();
    },
  };
};

/**
 * Tells native while a card session runs, from its start until its lookup ends, so a
 * tile tap leaves it alone. A card can start a new session before the last one is done.
 */
export const trackCardSessions = (
  report: (running: boolean) => void,
): ((session: { readonly done: Promise<void> }) => void) => {
  let running = 0;
  return ({ done }) => {
    if (running++ === 0) report(true);
    void done.then(() => {
      if (--running === 0) report(false);
    });
  };
};
