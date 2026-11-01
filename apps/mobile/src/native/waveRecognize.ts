import type { RecognizeAnswer, RecognizeSource } from "@wave/core";
import { NativeModule, requireOptionalNativeModule } from "expo";

import type { RecognizeNative } from "@/recognize/recognizeSession";
import type { RecognizeTileNative } from "@/recognize/recognizeTile";

/** Recognize's native half (`modules/wave-native`, `recognize/RecognizeModule.kt`). */
type WaveRecognizeEvents = {
  /** Session [session] has heard [heardMs] of audio in all; every quarter second. */
  onRecognizeHeard: (event: { session: number; heardMs: number; audible: boolean }) => void;
  /** Session [session]'s audio stopped on its own. */
  onRecognizeCaptureFailed: (event: { session: number }) => void;
  /** A tile or launcher shortcut asks the foreground UI to open Recognize. */
  onRecognizeRequested: () => void;
  /** A tile tap is waiting for `takeTileRequest`. */
  onRecognizeTileRequested: () => void;
  /** The tile or its notification cancelled tap [tap]'s session. */
  onRecognizeTileCancelled: (event: { tap: number }) => void;
};

declare class WaveRecognizeModule extends NativeModule<WaveRecognizeEvents> {
  playbackActivity(): Promise<{ activeMediaPlayers: number; waveMediaPlayers: number }>;
  /** Starts capturing; phone audio waits for fresh Android consent. */
  start(source: RecognizeSource, request: number): Promise<number>;
  cancelStart(request: number): void;
  /** Sends the signature of the latest [windowMs] the session heard; [last] stops its capture first. */
  ask(session: number, last: boolean, windowMs: number): Promise<RecognizeAnswer>;
  stop(session: number): void;
  takeRequest(): boolean;
  /** The tile's capture, not ending with Wave's screen. */
  startDetached(source: RecognizeSource, request: number): Promise<number>;
  takeTileRequest(): number;
  setCardSession(running: boolean): void;
  tileListeningEnded(tap: number): void;
  tileFinished(): void;
  notifyTileMatch(title: string, text: string, coverUrl: string | null): void;
  notifyTileNoMatch(title: string, text: string): void;
}

/** Null in a build without it (a JS repack over an older APK): Search then has no Recognize button. */
const WaveRecognize = requireOptionalNativeModule<WaveRecognizeModule>("WaveRecognize");

/** Null in an older APK that has capture but predates the tile and shortcut. */
export const recognizeRequests =
  WaveRecognize === null || typeof WaveRecognize.takeRequest !== "function"
    ? null
    : {
        take: () => WaveRecognize.takeRequest(),
        subscribe: (listener: () => void) => {
          const subscription = WaveRecognize.addListener("onRecognizeRequested", listener);
          return () => subscription.remove();
        },
      };

/** The module as `startRecognizeSession` takes it; null without it. */
export const recognizeNative: RecognizeNative | null =
  WaveRecognize === null || typeof WaveRecognize.playbackActivity !== "function"
    ? null
    : {
        playbackActivity: () => WaveRecognize.playbackActivity(),
        start: (source, request) => WaveRecognize.start(source, request),
        cancelStart: (request) => WaveRecognize.cancelStart(request),
        ask: (session, last, windowMs) => WaveRecognize.ask(session, last, windowMs),
        stop: (session) => WaveRecognize.stop(session),
        onHeard: (listener) => {
          const subscription = WaveRecognize.addListener("onRecognizeHeard", (event) =>
            listener(event.session, event.heardMs, event.audible),
          );
          return () => subscription.remove();
        },
        onCaptureFailed: (listener) => {
          const subscription = WaveRecognize.addListener("onRecognizeCaptureFailed", (event) =>
            listener(event.session),
          );
          return () => subscription.remove();
        },
      };

/** Null in an older APK, whose tile opens the card. */
export const recognizeTile: (RecognizeTileNative & { readonly capture: RecognizeNative }) | null =
  WaveRecognize === null ||
  recognizeNative === null ||
  typeof WaveRecognize.takeTileRequest !== "function"
    ? null
    : {
        capture: {
          ...recognizeNative,
          start: (source, request) => WaveRecognize.startDetached(source, request),
        },
        take: () => WaveRecognize.takeTileRequest(),
        onRequested: (listener) => {
          const subscription = WaveRecognize.addListener("onRecognizeTileRequested", listener);
          return () => subscription.remove();
        },
        onCancelled: (listener) => {
          const subscription = WaveRecognize.addListener("onRecognizeTileCancelled", (event) =>
            listener(event.tap),
          );
          return () => subscription.remove();
        },
        listeningEnded: (tap) => WaveRecognize.tileListeningEnded(tap),
        finished: () => WaveRecognize.tileFinished(),
        notify: ({ kind, title, text, coverUrl }) => {
          if (kind === "match") WaveRecognize.notifyTileMatch(title, text, coverUrl);
          else WaveRecognize.notifyTileNoMatch(title, text);
        },
      };

/** Tells the tile whether a card session runs; a tap then leaves it alone. */
export const reportCardSession = (running: boolean): void => {
  if (recognizeTile !== null) WaveRecognize?.setCardSession(running);
};
