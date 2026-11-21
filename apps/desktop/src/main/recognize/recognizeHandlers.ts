/** Main's side of `window.wave.recognize`: each call checked before Recognize hears it. */
import * as Effect from "effect/Effect";
import type { BridgeContract } from "../../shared/bridge.ts";
import {
  MAX_RECOGNIZE_AUDIO_BYTES,
  RECOGNIZE_RUN_ACTIONS,
  type RECOGNIZE_CALLS,
  type RecognizeRunAction,
} from "../../shared/recognize.ts";
import { Recognize, type RecognizeShape } from "./recognizeLayer.ts";

type Call = (typeof RECOGNIZE_CALLS)[number];
type Handlers = {
  readonly [C in Call]: (
    args: readonly unknown[],
  ) => Effect.Effect<BridgeContract[C]["result"], unknown, Recognize>;
};

const refuse = (call: Call, why: string) => Effect.fail(new Error(`Refused ${call}: ${why}`));

const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const withRecognize = <A>(act: (recognize: RecognizeShape) => A) => Effect.map(Recognize, act);

export const recognizeHandlers: Handlers = {
  "recognize.start": (args) =>
    args.length === 1 && (args[0] === "microphone" || args[0] === "playback")
      ? withRecognize((recognize) => recognize.start(args[0] as "microphone" | "playback"))
      : refuse("recognize.start", "invalid source"),
  "recognize.view": () => withRecognize((recognize) => recognize.view()),
  "recognize.close": () => withRecognize((recognize) => recognize.close()),
  "recognize.audio": ([session, pcm]) =>
    positive(session) &&
    pcm instanceof Uint8Array &&
    pcm.length % 2 === 0 &&
    pcm.length <= MAX_RECOGNIZE_AUDIO_BYTES
      ? withRecognize((recognize) => recognize.audio(session, pcm))
      : refuse("recognize.audio", "invalid audio"),
  "recognize.captureEnded": ([session, why]) =>
    positive(session) && (why === "denied" || why === "failed")
      ? withRecognize((recognize) => recognize.captureEnded(session, why))
      : refuse("recognize.captureEnded", "invalid session"),
  "recognize.run": (args) => {
    const [action, playlistId] = args;
    return args.length <= 2 &&
      RECOGNIZE_RUN_ACTIONS.includes(action as RecognizeRunAction) &&
      (action === "addToPlaylist" ? positive(playlistId) : playlistId === undefined)
      ? Effect.flatMap(Recognize, (recognize) =>
          Effect.tryPromise({
            try: () =>
              recognize.run(action as RecognizeRunAction, playlistId as number | undefined),
            catch: (error) => error,
          }),
        )
      : refuse("recognize.run", "invalid action or playlist");
  },
};
