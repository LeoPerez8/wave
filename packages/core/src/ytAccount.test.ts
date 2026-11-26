import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  YT_ACCOUNT_SIGNED_OUT,
  stepYtAccount,
  ytAccountView,
  ytSignInEmail,
  ytSignInFollowsWave,
} from "./index.ts";
import type { WaveSession, YtAccount, YtAccountState, YtSession } from "./index.ts";

const leo: YtAccount = {
  name: "Leo Perez",
  email: "leo@example.com",
  photoUrl: "https://yt3.ggpht.com/leo=s108",
};
const withSession = (session: YtSession): YtAccountState => ({ ...YT_ACCOUNT_SIGNED_OUT, session });
const signedIn = withSession({ status: "signedIn", account: leo });

describe("ytAccountView", () => {
  test("signed out, Settings offers Sign In and says it's optional", () => {
    assert.deepEqual(ytAccountView(YT_ACCOUNT_SIGNED_OUT, true), {
      kind: "signedOut",
      action: "signIn",
      note: "optional",
    });
  });

  test("signed in, Settings shows the account's name and picture and offers Sign Out", () => {
    assert.deepEqual(ytAccountView(signedIn, true), {
      kind: "account",
      account: leo,
      action: "signOut",
    });
  });

  test("an expired session shows as signed out, asking to sign in again", () => {
    const expired: YtAccountState = withSession({ status: "expired", account: leo });
    assert.deepEqual(ytAccountView(expired, true), {
      kind: "signedOut",
      action: "signInAgain",
      note: "expired",
    });
  });

  test("with YT Music off there's no Sign In, since signing in talks to Google", () => {
    assert.equal(ytAccountView(YT_ACCOUNT_SIGNED_OUT, false), null);
    const expired: YtAccountState = withSession({ status: "expired", account: null });
    assert.equal(ytAccountView(expired, false), null);
  });

  test("with YT Music off a signed-in account can still be signed out of", () => {
    assert.deepEqual(ytAccountView(signedIn, false), {
      kind: "account",
      account: leo,
      action: "signOut",
    });
  });
});

describe("stepYtAccount", () => {
  test("Sign In is busy until the sign-in page returns, then the account shows", () => {
    const signingIn = stepYtAccount(YT_ACCOUNT_SIGNED_OUT, { type: "signInStarted" });
    assert.deepEqual(ytAccountView(signingIn, true), {
      kind: "signedOut",
      action: "signingIn",
      note: "optional",
    });
    const done = stepYtAccount(signingIn, {
      type: "signInEnded",
      outcome: { status: "signedIn", account: leo },
    });
    assert.deepEqual(ytAccountView(done, true), {
      kind: "account",
      account: leo,
      action: "signOut",
    });
  });

  test("a sign-in that fails says why in a quiet line, and Sign In can be tried again", () => {
    const signingIn = stepYtAccount(YT_ACCOUNT_SIGNED_OUT, { type: "signInStarted" });
    const offline = stepYtAccount(signingIn, { type: "signInFailed", reason: "offline" });
    assert.deepEqual(ytAccountView(offline, true), {
      kind: "signedOut",
      action: "signIn",
      note: "offline",
    });
    const retried = stepYtAccount(offline, { type: "signInStarted" });
    assert.deepEqual(ytAccountView(retried, true), {
      kind: "signedOut",
      action: "signingIn",
      note: "optional",
    });
  });

  test("backing out of the sign-in page leaves the account as it was", () => {
    const expired = withSession({ status: "expired", account: leo });
    const signingIn = stepYtAccount(expired, { type: "signInStarted" });
    assert.deepEqual(stepYtAccount(signingIn, { type: "signInCancelled" }), expired);
  });

  test("a session that ends while Settings is open shows as soon as Wave hears of it", () => {
    const ended = stepYtAccount(signedIn, {
      type: "sessionChanged",
      session: { status: "expired", account: leo },
    });
    assert.deepEqual(ytAccountView(ended, true), {
      kind: "signedOut",
      action: "signInAgain",
      note: "expired",
    });
  });

  test("signing out shows Sign In again, without the old prompt or failure", () => {
    const failed = stepYtAccount(withSession({ status: "expired", account: leo }), {
      type: "signInFailed",
      reason: "failed",
    });
    const signedOut = stepYtAccount(failed, {
      type: "sessionChanged",
      session: { status: "signedOut" },
    });
    assert.deepEqual(ytAccountView(signedOut, true), {
      kind: "signedOut",
      action: "signIn",
      note: "optional",
    });
  });

  test("while the sign-in page is open, news of the old session keeps the button waiting", () => {
    const signingIn = stepYtAccount(signedIn, { type: "signInStarted" });
    const ended = stepYtAccount(signingIn, {
      type: "sessionChanged",
      session: { status: "expired", account: leo },
    });
    assert.deepEqual(ytAccountView(ended, true), {
      kind: "signedOut",
      action: "signingIn",
      note: "expired",
    });
  });
});

describe("ytSignInFollowsWave", () => {
  const wave: WaveSession = {
    status: "signedIn",
    account: { email: "ana@example.com", name: null, photoUrl: null },
  };

  test("a Wave account sign-in opens YT Music's when it's on and signed out", () => {
    assert.equal(ytSignInFollowsWave(wave, true, { status: "signedOut" }), true);
  });

  test("YT Music off, or a YouTube account already kept, opens nothing", () => {
    assert.equal(ytSignInFollowsWave(wave, false, { status: "signedOut" }), false);
    assert.equal(ytSignInFollowsWave(wave, true, { status: "signedIn", account: leo }), false);
    assert.equal(ytSignInFollowsWave(wave, true, { status: "expired", account: leo }), false);
  });

  test("a Wave session that isn't signed in opens nothing", () => {
    assert.equal(
      ytSignInFollowsWave({ status: "signedOut" }, true, { status: "signedOut" }),
      false,
    );
    assert.equal(
      ytSignInFollowsWave({ status: "ended", account: wave.account }, true, {
        status: "signedOut",
      }),
      false,
    );
  });
});

test("YT Music sign-in prefers the expired account, then Wave, then asks for an email", () => {
  const wave: WaveSession = {
    status: "signedIn",
    account: { email: "wave@example.com", name: null, photoUrl: null },
  };
  assert.equal(ytSignInEmail({ status: "expired", account: leo }, wave), "leo@example.com");
  assert.equal(
    ytSignInEmail({ status: "expired", account: { ...leo, email: null } }, wave),
    "wave@example.com",
  );
  assert.equal(ytSignInEmail({ status: "signedOut" }, wave), "wave@example.com");
  assert.equal(
    ytSignInEmail({ status: "signedOut" }, { status: "ended", account: wave.account }),
    null,
  );
});
