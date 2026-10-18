import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SPOTIFY_ACCOUNT_SIGNED_OUT,
  SPOTIFY_SIGN_IN_FAILURE_LINES,
  spotifyAccountView,
  spotifyLibraryFailure,
  stepSpotifyAccount,
} from "./index.ts";
import type { SpotifyAccount, SpotifyAccountState, SpotifySession } from "./index.ts";

const leo: SpotifyAccount = { name: "Leo Perez", photoUrl: "https://i.scdn.co/image/leo" };
const withSession = (session: SpotifySession): SpotifyAccountState => ({
  ...SPOTIFY_ACCOUNT_SIGNED_OUT,
  session,
});
const signedIn = withSession({ status: "signedIn", account: leo });

describe("spotifyAccountView", () => {
  test("signed out, Settings offers Sign In and says what signing in is for", () => {
    assert.deepEqual(spotifyAccountView(SPOTIFY_ACCOUNT_SIGNED_OUT), {
      kind: "signedOut",
      action: "signIn",
      note: "optional",
    });
  });

  test("signed in, Settings shows the account's name and photo and offers Sign Out", () => {
    assert.deepEqual(spotifyAccountView(signedIn), {
      kind: "account",
      account: leo,
      action: "signOut",
    });
  });

  test("a session Spotify stopped accepting shows as signed out, asking to sign in again", () => {
    assert.deepEqual(spotifyAccountView(withSession({ status: "expired", account: leo })), {
      kind: "signedOut",
      action: "signInAgain",
      note: "expired",
    });
  });
});

describe("stepSpotifyAccount", () => {
  test("Sign In waits while Spotify's page is open, then the account shows", () => {
    const signingIn = stepSpotifyAccount(SPOTIFY_ACCOUNT_SIGNED_OUT, { type: "signInStarted" });
    assert.deepEqual(spotifyAccountView(signingIn), {
      kind: "signedOut",
      action: "signingIn",
      note: "optional",
    });
    const done = stepSpotifyAccount(signingIn, {
      type: "signInEnded",
      outcome: { status: "signedIn", account: leo },
    });
    assert.deepEqual(spotifyAccountView(done), {
      kind: "account",
      account: leo,
      action: "signOut",
    });
  });

  test("when Spotify changed its sign-in, Settings says Wave needs an update, not that the sign-in failed", () => {
    const expired = withSession({ status: "expired", account: leo });
    const signingIn = stepSpotifyAccount(expired, { type: "signInStarted" });
    const changed = stepSpotifyAccount(signingIn, { type: "signInFailed", reason: "changed" });
    assert.deepEqual(spotifyAccountView(changed), {
      kind: "signedOut",
      action: "signInAgain",
      note: "changed",
    });
  });

  test("backing out of Spotify's page leaves the account as it was", () => {
    const signingIn = stepSpotifyAccount(signedIn, { type: "signInStarted" });
    assert.deepEqual(stepSpotifyAccount(signingIn, { type: "signInCancelled" }), signedIn);
  });

  test("a session that ends while Settings is open shows as soon as Wave hears of it", () => {
    const ended = stepSpotifyAccount(signedIn, {
      type: "sessionChanged",
      session: { status: "expired", account: leo },
    });
    assert.equal(spotifyAccountView(ended).action, "signInAgain");
  });

  test("signing out shows Sign In without the last failure", () => {
    const failed = stepSpotifyAccount(SPOTIFY_ACCOUNT_SIGNED_OUT, {
      type: "signInFailed",
      reason: "offline",
    });
    const signedOut = stepSpotifyAccount(failed, {
      type: "sessionChanged",
      session: { status: "signedOut" },
    });
    assert.deepEqual(spotifyAccountView(signedOut), {
      kind: "signedOut",
      action: "signIn",
      note: "optional",
    });
  });
});

describe("SPOTIFY_SIGN_IN_FAILURE_LINES", () => {
  test("says why a sign-in didn't work, wherever it was started", () => {
    assert.deepEqual(SPOTIFY_SIGN_IN_FAILURE_LINES, {
      offline: "Couldn't sign in without a connection.",
      failed: "Spotify didn't confirm the sign-in. Try again.",
      changed: "Spotify changed something. Try again after updating Wave.",
    });
  });

  test("says Spotify changed something the way the From Spotify picker does", () => {
    assert.equal(spotifyLibraryFailure("changed").line, SPOTIFY_SIGN_IN_FAILURE_LINES.changed);
  });
});
