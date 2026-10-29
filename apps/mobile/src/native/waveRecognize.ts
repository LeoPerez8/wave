import type { RecognizeAnswer, RecognizeSource } from "@wave/core";
import { NativeModule, requireOptionalNativeModule } from "expo";

import type { RecognizeNative } from "@/recognize/recognizeSession";

/** Recognize's native half (`modules/wave-native`, `recognize/RecognizeModule.kt`). */
type WaveRecognizeEvents = {
  /** Session [session] has heard [heardMs] of audio in all; every quarter second. */
  onRecognizeHeard: (event: { session: number; heardMs: number }) => void;
  /** Session [session]'s audio stopped on its own. */
  onRecognizeCaptureFailed: (event: { session: number }) => void;
};

declare class WaveRecognizeModule extends NativeModule<WaveRecognizeEvents> {
  /** Starts capturing; the session's id. Rejects without RECORD_AUDIO or a microphone. */
  start(source: RecognizeSource): Promise<number>;
  /** Sends the signature of everything the session heard; [last] stops its capture first. */
  ask(session: number, last: boolean): Promise<RecognizeAnswer>;
  stop(session: number): void;
}

/** Null in a build without it (a JS repack over an older APK): Search then has no Recognize button. */
const WaveRecognize = requireOptionalNativeModule<WaveRecognizeModule>("WaveRecognize");

/** The module as `startRecognizeSession` takes it; null without it. */
export const recognizeNative: RecognizeNative | null =
  WaveRecognize === null
    ? null
    : {
        start: (source) => WaveRecognize.start(source),
        ask: (session, last) => WaveRecognize.ask(session, last),
        stop: (session) => WaveRecognize.stop(session),
        onHeard: (listener) => {
          const subscription = WaveRecognize.addListener("onRecognizeHeard", (event) =>
            listener(event.session, event.heardMs),
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
