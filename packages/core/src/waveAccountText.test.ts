import assert from "node:assert/strict";
import { test } from "node:test";

import {
  catalogueOf,
  stepWaveAccount,
  waveAccountActionNotes,
  waveAccountNotes,
  waveAccountView,
  waveSignInLabels,
  WAVE_ACCOUNT_SIGNED_OUT,
} from "./index.ts";
import type { WaveAccountActionNote, WaveAccountNote } from "./index.ts";

const NOTES: readonly WaveAccountNote[] = [
  "about",
  "ended",
  "deleted",
  "signedOutEverywhere",
  "offline",
  "noGoogleAccount",
  "notAllowed",
  "accountsFull",
  "newAccountsPaused",
  "failed",
];

const ACTION_NOTES: readonly WaveAccountActionNote[] = [
  "offline",
  "failed",
  "wrongGoogleAccount",
  "signOutEverywhereOffline",
  "signOutEverywhereFailed",
];

test("every note under Sign In has its own text on the phone, in each language", () => {
  for (const language of ["en", "pt-BR"] as const) {
    const phone = waveAccountNotes(catalogueOf(language));
    assert.equal(new Set(NOTES.map((note) => phone[note])).size, NOTES.length, language);
    // The computer signs in through the browser: it has no Google account to ask the owner to add.
    const desktop = waveAccountNotes(catalogueOf(language, "desktop"));
    assert.ok(NOTES.every((note) => desktop[note].length > 0));
    assert.equal(desktop.noGoogleAccount, desktop.failed);
    assert.notEqual(phone.noGoogleAccount, phone.failed);
  }
});

test("a signed-out account's note and label are the catalogue's", () => {
  const strings = catalogueOf("en");
  const view = waveAccountView(WAVE_ACCOUNT_SIGNED_OUT, true);
  assert.equal(view.kind, "signedOut");
  if (view.kind !== "signedOut") return;
  assert.equal(waveAccountNotes(strings)[view.note], strings.settings.waveAccountNote);
  assert.equal(waveSignInLabels(strings)[view.action], strings.settings.signInWithGoogle);
});

test("the desktop's notes name the computer where the phone's name the phone", () => {
  const phone = waveAccountNotes(catalogueOf("en"));
  const desktop = waveAccountNotes(catalogueOf("en", "desktop"));
  assert.match(phone.ended, /phone/);
  assert.match(desktop.ended, /computer/);
  assert.equal(desktop.failed, phone.failed);
});

test("a sign-in that failed says why, and the button waits while it's on", () => {
  const strings = catalogueOf("en");
  const waiting = stepWaveAccount(WAVE_ACCOUNT_SIGNED_OUT, { type: "signInStarted" });
  const waitingView = waveAccountView(waiting, true);
  assert.equal(waitingView.kind, "signedOut");
  if (waitingView.kind !== "signedOut") return;
  assert.equal(waveSignInLabels(strings)[waitingView.action], strings.settings.signingIn);
  const failed = waveAccountView(
    stepWaveAccount(waiting, { type: "signInFailed", reason: "offline" }),
    true,
  );
  assert.equal(failed.kind, "signedOut");
  if (failed.kind !== "signedOut") return;
  assert.equal(
    waveAccountNotes(strings)[failed.note],
    strings.settings.couldntSignInWithoutAConnection,
  );
});

test("every note under the account's buttons has text: deleting and signing out everywhere differ", () => {
  for (const language of ["en", "pt-BR"] as const) {
    const strings = catalogueOf(language);
    const notes = waveAccountActionNotes(strings);
    assert.equal(new Set(ACTION_NOTES.map((note) => notes[note])).size, ACTION_NOTES.length);
    assert.equal(
      notes.signOutEverywhereOffline,
      strings.settings.couldntSignOutOnAllPhonesWithoutAConnection,
    );
    assert.equal(notes.offline, strings.settings.couldntDeleteTheAccountWithoutAConnection);
  }
});
