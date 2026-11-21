import { GENIUS_LOADING_NOTE_DELAY_MS, geniusTranslationTarget } from "@wave/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AccountView } from "../../shared/account.ts";
import type { BrowseRow } from "../../shared/browse.ts";
import type { SongGenius } from "../../shared/lyrics.ts";
import { language } from "./text.ts";

type GeniusState = SongGenius | { readonly kind: "loading"; readonly showNote: boolean };
export type GeniusAccess = "off" | "signedIn" | "signedOut";

export function geniusAccess(view: AccountView | undefined): GeniusAccess {
  if (!view?.geniusInsights || view.account.kind === "unavailable") return "off";
  return view.account.kind === "account" ? "signedIn" : "signedOut";
}

const visible = () => !document.hidden;
const subscribeVisibility = (change: () => void) => {
  document.addEventListener("visibilitychange", change);
  return () => document.removeEventListener("visibilitychange", change);
};

/** Look up insights while lyrics are visible, dropping late answers when their view closes. */
export function useSongGenius(
  trackId: string | null,
  song: BrowseRow | null,
  access: GeniusAccess,
  foreground: boolean,
) {
  const windowVisible = useSyncExternalStore(subscribeVisibility, visible);
  const onScreen = foreground && windowVisible;
  const target = geniusTranslationTarget(language);
  const key =
    trackId !== null && access !== "off"
      ? JSON.stringify([trackId, song?.title, song?.artist, access, target])
      : null;
  const [attempt, setAttempt] = useState<{ key: string; number: number }>();
  const attemptNumber = attempt?.key === key ? attempt.number : 0;
  const [answer, setAnswer] = useState<{ key: string; attempt: number; state: GeniusState }>();

  useEffect(() => {
    if (key === null || trackId === null || !onScreen) return;
    const requestId = crypto.randomUUID();
    let current = true;
    const show = (state: GeniusState) => {
      if (current) setAnswer({ key, attempt: attemptNumber, state });
    };
    const note =
      access === "signedIn" && attemptNumber === 0
        ? setTimeout(() => show({ kind: "loading", showNote: true }), GENIUS_LOADING_NOTE_DELAY_MS)
        : undefined;
    void window.wave.lyrics.genius(trackId, requestId, "read").then(
      (state) => {
        clearTimeout(note);
        show(state);
        if (!current || target === null || state.kind !== "answer") return;
        // Show the original and its highlights while the translation arrives.
        void window.wave.lyrics.genius(trackId, requestId, "translate").then(
          (translated) => {
            if (translated.kind === "answer") show(translated);
          },
          () => {},
        );
      },
      () => {
        clearTimeout(note);
        show({ kind: "failed" });
      },
    );
    return () => {
      current = false;
      clearTimeout(note);
      void window.wave.lyrics.cancelGenius(requestId).catch(() => {});
    };
  }, [access, attemptNumber, key, onScreen, target, trackId]);

  const state: GeniusState =
    key === null
      ? { kind: "hidden" }
      : answer?.key === key && answer.attempt === attemptNumber
        ? answer.state
        : { kind: "loading", showNote: attemptNumber > 0 };
  return {
    state,
    retry: () => {
      if (key !== null) setAttempt({ key, number: attemptNumber + 1 });
    },
  };
}
