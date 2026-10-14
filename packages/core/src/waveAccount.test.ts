import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CONFIRM_WAVE_ACCOUNT_DELETION,
  WAVE_ACCOUNT_CARD,
  WAVE_ACCOUNT_SIGNED_OUT,
  planAlert,
  stepWaveAccount,
  waveAccountConfig,
  waveAccountView,
} from "./index.ts";
import type { WaveAccount, WaveAccountState, WaveSession } from "./index.ts";

const ana: WaveAccount = {
  email: "ana@example.com",
  name: "Ana Lima",
  photoUrl: "https://lh3.googleusercontent.com/a/ana=s96-c",
};
const withSession = (session: WaveSession): WaveAccountState => ({
  ...WAVE_ACCOUNT_SIGNED_OUT,
  session,
});
const signedIn = withSession({ status: "signedIn", account: ana });

describe("waveAccountView", () => {
  test("signed out, Settings says what the account is for and offers Sign In with Google", () => {
    assert.deepEqual(waveAccountView(WAVE_ACCOUNT_SIGNED_OUT, true), {
      kind: "signedOut",
      action: "signIn",
      note: "about",
    });
  });

  test("on a build without the service's URL or Google's client id, there's no Sign In", () => {
    assert.deepEqual(waveAccountView(WAVE_ACCOUNT_SIGNED_OUT, false), { kind: "unavailable" });
  });

  test("signed in, Settings shows the account and offers Sign Out and Delete Account", () => {
    assert.deepEqual(waveAccountView(signedIn, true), {
      kind: "account",
      account: ana,
      busy: null,
      note: null,
    });
  });

  test("a signed-in account shows even on a build without the service, so it can be signed out of", () => {
    assert.equal(waveAccountView(signedIn, false).kind, "account");
  });
});

describe("the first sign-in's card", () => {
  const { message } = WAVE_ACCOUNT_CARD;

  test("says what goes up, the Soulseek account included", () => {
    for (const item of [
      "song list",
      "playlists",
      "favorites",
      "play history",
      "preferences",
      "Soulseek account Download in best quality made",
    ])
      assert.ok(message.includes(item), `missing "${item}"`);
  });

  test("says what never goes up", () => {
    for (const item of ["audio", "file paths", "YouTube sign-in"])
      assert.ok(message.toLowerCase().includes(item.toLowerCase()), `missing "${item}"`);
  });

  test("offers Cancel and Continue", () => {
    assert.deepEqual(
      planAlert(WAVE_ACCOUNT_CARD).buttons.map(({ label, tone }) => [label, tone]),
      [
        ["Cancel", "accent"],
        ["Continue", "accent"],
      ],
    );
  });
});

describe("confirming Delete Account", () => {
  test("is destructive and says the phone keeps everything", () => {
    assert.deepEqual(
      planAlert(CONFIRM_WAVE_ACCOUNT_DELETION).buttons.map(({ label, tone }) => [label, tone]),
      [
        ["Cancel", "accent"],
        ["Delete Account", "destructive"],
      ],
    );
    assert.match(CONFIRM_WAVE_ACCOUNT_DELETION.message, /Nothing on this phone is deleted/);
  });
});

describe("waveAccountConfig", () => {
  test("reads the service's URL and Google's web client id from the app config's extra", () => {
    assert.deepEqual(
      waveAccountConfig({
        syncUrl: "https://wave-sync.example.workers.dev/",
        googleWebClientId: "123-abc.apps.googleusercontent.com",
      }),
      {
        syncUrl: "https://wave-sync.example.workers.dev",
        googleWebClientId: "123-abc.apps.googleusercontent.com",
      },
    );
  });

  test("a build whose extra is still empty has no Wave account", () => {
    assert.equal(waveAccountConfig({ syncUrl: "", googleWebClientId: "" }), null);
    assert.equal(waveAccountConfig(undefined), null);
    assert.equal(waveAccountConfig({}), null);
  });

  test("half a setup is no setup", () => {
    assert.equal(
      waveAccountConfig({
        syncUrl: "https://wave-sync.example.workers.dev",
        googleWebClientId: " ",
      }),
      null,
    );
    assert.equal(
      waveAccountConfig({ syncUrl: "", googleWebClientId: "123-abc.apps.googleusercontent.com" }),
      null,
    );
  });

  test("a service URL that isn't http(s) is no setup", () => {
    assert.equal(
      waveAccountConfig({
        syncUrl: "wave-sync.example.workers.dev",
        googleWebClientId: "123-abc.apps.googleusercontent.com",
      }),
      null,
    );
  });
});

describe("stepWaveAccount", () => {
  test("Sign In waits while Google's picker is open, then the account shows", () => {
    const signingIn = stepWaveAccount(WAVE_ACCOUNT_SIGNED_OUT, { type: "signInStarted" });
    assert.deepEqual(waveAccountView(signingIn, true), {
      kind: "signedOut",
      action: "signingIn",
      note: "about",
    });
    const ended = stepWaveAccount(signingIn, {
      type: "signInEnded",
      session: { status: "signedIn", account: ana },
    });
    assert.deepEqual(waveAccountView(ended, true), waveAccountView(signedIn, true));
  });

  test("cancelling Google's picker leaves the section as it was", () => {
    const signingIn = stepWaveAccount(WAVE_ACCOUNT_SIGNED_OUT, { type: "signInStarted" });
    const cancelled = stepWaveAccount(signingIn, { type: "signInCancelled" });
    assert.deepEqual(
      waveAccountView(cancelled, true),
      waveAccountView(WAVE_ACCOUNT_SIGNED_OUT, true),
    );
  });

  test("signing in offline says so and stays signed out", () => {
    const signingIn = stepWaveAccount(WAVE_ACCOUNT_SIGNED_OUT, { type: "signInStarted" });
    const offline = stepWaveAccount(signingIn, { type: "signInFailed", reason: "offline" });
    assert.deepEqual(waveAccountView(offline, true), {
      kind: "signedOut",
      action: "signIn",
      note: "offline",
    });
  });

  test("the next sign-in clears why the last one didn't work", () => {
    const refused = stepWaveAccount(WAVE_ACCOUNT_SIGNED_OUT, {
      type: "signInFailed",
      reason: "notAllowed",
    });
    assert.deepEqual(waveAccountView(refused, true), {
      kind: "signedOut",
      action: "signIn",
      note: "notAllowed",
    });
    const again = stepWaveAccount(refused, { type: "signInStarted" });
    assert.deepEqual(waveAccountView(again, true), {
      kind: "signedOut",
      action: "signingIn",
      note: "about",
    });
  });

  test("a session the service ended signs the app out, and the section says so", () => {
    const ended = stepWaveAccount(signedIn, {
      type: "sessionChanged",
      session: { status: "ended", account: ana },
    });
    assert.deepEqual(waveAccountView(ended, true), {
      kind: "signedOut",
      action: "signInAgain",
      note: "ended",
    });
  });

  test("signing in again after the session ended is an ordinary sign-in", () => {
    const ended = withSession({ status: "ended", account: ana });
    const signingIn = stepWaveAccount(ended, { type: "signInStarted" });
    assert.deepEqual(waveAccountView(signingIn, true), {
      kind: "signedOut",
      action: "signingIn",
      note: "ended",
    });
    const offline = stepWaveAccount(signingIn, { type: "signInFailed", reason: "offline" });
    assert.deepEqual(waveAccountView(offline, true), {
      kind: "signedOut",
      action: "signInAgain",
      note: "offline",
    });
  });

  test("Sign Out waits for the service, then the section is signed out", () => {
    const signingOut = stepWaveAccount(signedIn, { type: "signOutStarted" });
    assert.deepEqual(waveAccountView(signingOut, true), {
      kind: "account",
      account: ana,
      busy: "signingOut",
      note: null,
    });
    const out = stepWaveAccount(signingOut, {
      type: "sessionChanged",
      session: { status: "signedOut" },
    });
    assert.deepEqual(waveAccountView(out, true), waveAccountView(WAVE_ACCOUNT_SIGNED_OUT, true));
  });

  test("a deleted account signs the app out and the section says it's gone", () => {
    const deleting = stepWaveAccount(signedIn, { type: "deleteStarted" });
    assert.deepEqual(waveAccountView(deleting, true), {
      kind: "account",
      account: ana,
      busy: "deleting",
      note: null,
    });
    const deleted = stepWaveAccount(deleting, { type: "accountDeleted" });
    assert.deepEqual(waveAccountView(deleted, true), {
      kind: "signedOut",
      action: "signIn",
      note: "deleted",
    });
  });

  test("the signed-out session the native module reports after deletion keeps saying it's gone", () => {
    const deleted = stepWaveAccount(signedIn, { type: "accountDeleted" });
    const reported = stepWaveAccount(deleted, {
      type: "sessionChanged",
      session: { status: "signedOut" },
    });
    assert.deepEqual(waveAccountView(reported, true), {
      kind: "signedOut",
      action: "signIn",
      note: "deleted",
    });
  });

  test("deleting offline says so and keeps the account", () => {
    const deleting = stepWaveAccount(signedIn, { type: "deleteStarted" });
    const offline = stepWaveAccount(deleting, { type: "deleteFailed", reason: "offline" });
    assert.deepEqual(waveAccountView(offline, true), {
      kind: "account",
      account: ana,
      busy: null,
      note: "offline",
    });
  });

  test("a session that ended while deleting shows as ended", () => {
    const deleting = stepWaveAccount(signedIn, { type: "deleteStarted" });
    const ended = stepWaveAccount(deleting, {
      type: "sessionChanged",
      session: { status: "ended", account: ana },
    });
    assert.deepEqual(waveAccountView(ended, true), {
      kind: "signedOut",
      action: "signInAgain",
      note: "ended",
    });
    assert.deepEqual(waveAccountView(stepWaveAccount(ended, { type: "signInStarted" }), true), {
      kind: "signedOut",
      action: "signingIn",
      note: "ended",
    });
  });
});
