/**
 * Sign In, with a quiet first try at the default browser's existing session before the window
 * (docs/spec-desktop.md, Sign-in). When the owner is already signed in to Google in their default
 * browser, Wave reads that session straight from its cookie store and the sign-in ends at once,
 * with no window; when it cannot — no readable session, or a platform without the cookie path — it
 * opens the window exactly as before, with that flow's own outcome and cancellation.
 */
import type { SignedInSession } from "./ytCookieSession.ts";
import type { YtBrowserSignIn } from "./ytBrowserSignIn.ts";

export interface YtSignInOptions {
  /** The session read from the default browser, or null to open the window. May block briefly. */
  readonly readExistingSession: () => SignedInSession | null;
  /** Opens the sign-in window; only called when the quiet read found no session. */
  readonly startWindow: () => YtBrowserSignIn;
}

export const startYtSignIn = ({
  readExistingSession,
  startWindow,
}: YtSignInOptions): YtBrowserSignIn => {
  const existing = readExistingSession();
  if (existing !== null) return { outcome: Promise.resolve(existing), cancel: () => {} };
  return startWindow();
};
