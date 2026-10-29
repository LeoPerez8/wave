/**
 * Recognize's one app log line per session (docs/spec.md, "Recognize"):
 * log text, so it stays English and outside the untranslated-text check.
 */

import type { RecognizeLookup } from "./recognition.ts";
import type { RecognizeEnd, RecognizeSource } from "./recognize.ts";

/** How a session went for the log: its end, or why it never listened. */
export type RecognizeLogOutcome =
  RecognizeEnd | { readonly kind: "offline" } | { readonly kind: "denied" };

const SOURCE_NAMES: Readonly<Record<RecognizeSource, string>> = {
  microphone: "the microphone",
  playback: "this phone",
};

/**
 * The session's one app log line: the source, the seconds heard and the outcome
 * (with a refusal's HTTP status). Never the song, the audio or the signature.
 */
export const recognizeLogLine = (session: {
  readonly source: RecognizeSource;
  readonly heardMs: number;
  readonly outcome: RecognizeLogOutcome;
  readonly lookup?: RecognizeLookup;
}): string => {
  const { outcome } = session;
  const after = `after ${(session.heardMs / 1000).toFixed(1)} s`;
  const what = (() => {
    switch (outcome.kind) {
      case "offline":
        return "offline, nothing heard";
      case "denied":
        return "microphone permission denied, nothing heard";
      case "match":
        return `a match ${after}`;
      case "noMatch":
        return `no match ${after}`;
      case "cancelled":
        return `cancelled ${after}`;
      case "blocked":
        return `app blocks capture ${after}`;
      case "consentDeclined":
        return "capture consent declined, nothing heard";
      case "failed":
        return `failed ${after} (${outcome.failure}${outcome.status === null ? "" : `, HTTP ${outcome.status}`})`;
    }
  })();
  return `Recognize through ${SOURCE_NAMES[session.source]}: ${what}${session.lookup === undefined ? "" : `, YT Music lookup: ${session.lookup}`}`;
};
