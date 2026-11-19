import assert from "node:assert/strict";
import { test } from "node:test";
import type { YtBrowserSignIn } from "./ytBrowserSignIn.ts";
import type { SignedInSession } from "./ytCookieSession.ts";
import { startYtSignIn } from "./ytSignIn.ts";

const SESSION: SignedInSession = {
  kind: "signedIn",
  cookie: "SAPISID=x",
  dataSyncId: null,
  sessionIndex: "0",
};

test("an existing browser session is used and the window never opens", async () => {
  let opened = false;
  const signIn = startYtSignIn({
    readExistingSession: () => SESSION,
    startWindow: () => {
      opened = true;
      return { outcome: Promise.resolve({ kind: "closed" }), cancel: () => {} };
    },
  });
  assert.deepEqual(await signIn.outcome, SESSION);
  assert.equal(opened, false);
});

test("an existing session's sign-in has a cancel that is safe to call", () => {
  const signIn = startYtSignIn({
    readExistingSession: () => SESSION,
    startWindow: () => {
      throw new Error("must not open the window");
    },
  });
  assert.doesNotThrow(() => signIn.cancel());
});

test("with no existing session the window's own sign-in is returned unchanged", async () => {
  let cancelled = false;
  const window: YtBrowserSignIn = {
    outcome: Promise.resolve({
      kind: "signedIn",
      cookie: "W",
      dataSyncId: null,
      sessionIndex: "0",
    }),
    cancel: () => {
      cancelled = true;
    },
  };
  const signIn = startYtSignIn({
    readExistingSession: () => null,
    startWindow: () => window,
  });
  assert.equal(signIn, window);
  signIn.cancel();
  assert.equal(cancelled, true);
  const outcome = await signIn.outcome;
  assert.equal(outcome.kind === "signedIn" ? outcome.cookie : "", "W");
});
