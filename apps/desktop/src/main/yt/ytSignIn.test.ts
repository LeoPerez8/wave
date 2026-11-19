import assert from "node:assert/strict";
import { test } from "node:test";
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
    readExistingSession: () => Promise.resolve(SESSION),
    startWindow: () => {
      opened = true;
      return { outcome: Promise.resolve({ kind: "closed" }), cancel: () => {} };
    },
  });
  assert.deepEqual(await signIn.outcome, SESSION);
  assert.equal(opened, false);
});

test("with no existing session the window opens and its outcome is returned", async () => {
  let opened = false;
  const signIn = startYtSignIn({
    readExistingSession: () => Promise.resolve(null),
    startWindow: () => {
      opened = true;
      return {
        outcome: Promise.resolve({
          kind: "signedIn",
          cookie: "W",
          dataSyncId: null,
          sessionIndex: "0",
        }),
        cancel: () => {},
      };
    },
  });
  const outcome = await signIn.outcome;
  assert.equal(opened, true);
  assert.equal(outcome.kind === "signedIn" ? outcome.cookie : "", "W");
});

test("a rejected read falls through to the window rather than failing", async () => {
  let opened = false;
  const signIn = startYtSignIn({
    readExistingSession: () => Promise.reject(new Error("keyring blew up")),
    startWindow: () => {
      opened = true;
      return { outcome: Promise.resolve({ kind: "closed" }), cancel: () => {} };
    },
  });
  assert.deepEqual(await signIn.outcome, { kind: "closed" });
  assert.equal(opened, true);
});

test("cancelling during the read ends the sign-in without opening the window", async () => {
  let opened = false;
  let release: (value: SignedInSession | null) => void = () => {};
  const signIn = startYtSignIn({
    readExistingSession: () => new Promise((r) => (release = r)),
    startWindow: () => {
      opened = true;
      return { outcome: Promise.resolve({ kind: "closed" }), cancel: () => {} };
    },
  });
  signIn.cancel();
  release(null); // the read completes after the cancel
  assert.deepEqual(await signIn.outcome, { kind: "cancelled" });
  assert.equal(opened, false);
});

test("cancelling after the window opens cancels the window", async () => {
  let cancelledWindow = false;
  let endWindow: (value: { kind: "cancelled" }) => void = () => {};
  const signIn = startYtSignIn({
    readExistingSession: () => Promise.resolve(null),
    startWindow: () => ({
      outcome: new Promise((resolve) => (endWindow = resolve)),
      cancel: () => {
        cancelledWindow = true;
        endWindow({ kind: "cancelled" });
      },
    }),
  });
  await Promise.resolve(); // let the read resolve and the window open
  await Promise.resolve();
  signIn.cancel();
  assert.equal(cancelledWindow, true);
  assert.deepEqual(await signIn.outcome, { kind: "cancelled" });
});
