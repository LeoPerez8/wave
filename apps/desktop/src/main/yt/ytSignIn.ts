/**
 * Sign In, with a quiet first try at the default browser's existing session before the window
 * (docs/spec-desktop.md, Sign-in). When the owner is already signed in to Google in their default
 * browser, Wave reads that session straight from its cookie store and the sign-in ends with no
 * window; when it cannot — no readable session, or a platform without the cookie path — it opens
 * the window exactly as before, with that flow's own outcome and cancellation. Cancelling during
 * the quiet read ends the sign-in without opening a window.
 */
import type { SignedInSession } from "./ytCookieSession.ts";
import type { YtBrowserOutcome, YtBrowserSignIn } from "./ytBrowserSignIn.ts";

export interface YtSignInOptions {
  /** The session read from the default browser, or null to open the window. Reads the keyring. */
  readonly readExistingSession: () => Promise<SignedInSession | null>;
  /** Opens the sign-in window; only called when the quiet read found no session. */
  readonly startWindow: () => YtBrowserSignIn;
}

export const startYtSignIn = ({
  readExistingSession,
  startWindow,
}: YtSignInOptions): YtBrowserSignIn => {
  let cancelled = false;
  let window: YtBrowserSignIn | undefined;
  const outcome = (async (): Promise<YtBrowserOutcome> => {
    let existing: SignedInSession | null = null;
    try {
      existing = await readExistingSession();
    } catch {
      existing = null;
    }
    if (cancelled) return { kind: "cancelled" };
    if (existing !== null) return existing;
    window = startWindow();
    return window.outcome;
  })();
  return {
    outcome,
    cancel: () => {
      cancelled = true;
      window?.cancel();
    },
  };
};
