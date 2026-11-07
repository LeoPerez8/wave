import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextFirstRunStep, signInInvitationAtLaunch, type FirstRunState } from "./index.ts";

describe("signInInvitationAtLaunch", () => {
  it("makes the invitation due on a new install, which opens without all-files access", () => {
    assert.equal(
      signInInvitationAtLaunch({ stored: null, accessGranted: false, usedBefore: false }),
      "due",
    );
  });

  it("never makes it due on a phone updated from a version without it", () => {
    // Wave can't be used without access, so a phone that has it has used Wave.
    assert.equal(
      signInInvitationAtLaunch({ stored: null, accessGranted: true, usedBefore: false }),
      "done",
    );
    // An existing user who took access away still has what Wave kept.
    assert.equal(
      signInInvitationAtLaunch({ stored: null, accessGranted: false, usedBefore: true }),
      "done",
    );
  });

  it("keeps what was decided at the first launch", () => {
    assert.equal(
      signInInvitationAtLaunch({ stored: "due", accessGranted: true, usedBefore: true }),
      "due",
    );
    assert.equal(
      signInInvitationAtLaunch({ stored: "done", accessGranted: false, usedBefore: false }),
      "done",
    );
  });

  it("reads anything else stored as done, so a bad value never brings it back", () => {
    assert.equal(
      signInInvitationAtLaunch({ stored: "maybe", accessGranted: false, usedBefore: false }),
      "done",
    );
  });
});

/** A new install that has just been given access, with nothing in the way. */
const ready: FirstRunState = {
  accessGranted: true,
  invitation: "due",
  accountAvailable: true,
  signedIn: false,
  visible: true,
  nowPlayingShown: false,
  cardOpen: false,
  showing: false,
};

describe("nextFirstRunStep", () => {
  it("shows the access screen first, before anything else", () => {
    assert.equal(nextFirstRunStep({ ...ready, accessGranted: false }), "access");
    assert.equal(nextFirstRunStep({ ...ready, accessGranted: false, signedIn: null }), "access");
  });

  it("shows the invitation once access is granted on a new install", () => {
    assert.equal(nextFirstRunStep(ready), "signInInvitation");
  });

  it("is done once the invitation was dismissed or followed", () => {
    assert.equal(nextFirstRunStep({ ...ready, invitation: "done" }), "done");
  });

  it("waits for the native module to say whether an account is signed in", () => {
    assert.equal(nextFirstRunStep({ ...ready, signedIn: null }), "wait");
  });

  it("remembers it as done, unseen, when an account is already signed in", () => {
    assert.equal(nextFirstRunStep({ ...ready, signedIn: true }), "remember");
  });

  it("shows nothing on a build without the sync service, and keeps it due", () => {
    assert.equal(nextFirstRunStep({ ...ready, accountAvailable: false }), "done");
  });

  it("waits while Wave is in the background, Now Playing is up or another card is open", () => {
    assert.equal(nextFirstRunStep({ ...ready, visible: false }), "wait");
    assert.equal(nextFirstRunStep({ ...ready, nowPlayingShown: true }), "wait");
    assert.equal(nextFirstRunStep({ ...ready, cardOpen: true }), "wait");
  });

  it("opens it only once while it shows", () => {
    assert.equal(nextFirstRunStep({ ...ready, showing: true, cardOpen: true }), "wait");
  });
});
