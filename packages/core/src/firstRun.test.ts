import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  firstRunCardAtLaunch,
  nextFirstRunStep,
  signInInvitationAtLaunch,
  type FirstRunState,
} from "./index.ts";

for (const [name, atLaunch] of Object.entries({ signInInvitationAtLaunch, firstRunCardAtLaunch }))
  describe(name, () => {
    it("makes the card due on a new install, which opens without all-files access", () => {
      assert.equal(atLaunch({ stored: null, accessGranted: false, usedBefore: false }), "due");
    });

    it("never makes it due on a phone updated from a version without it", () => {
      // Wave can't be used without access, so a phone that has it has used Wave.
      assert.equal(atLaunch({ stored: null, accessGranted: true, usedBefore: false }), "done");
      // An existing user who took access away still has what Wave kept.
      assert.equal(atLaunch({ stored: null, accessGranted: false, usedBefore: true }), "done");
    });

    it("keeps what was decided at the first launch", () => {
      assert.equal(atLaunch({ stored: "due", accessGranted: true, usedBefore: true }), "due");
      assert.equal(atLaunch({ stored: "done", accessGranted: false, usedBefore: false }), "done");
    });

    it("reads anything else stored as done, so a bad value never brings it back", () => {
      assert.equal(atLaunch({ stored: "maybe", accessGranted: false, usedBefore: false }), "done");
    });
  });

/** A new install that has just been given access, with nothing in the way. */
const ready: FirstRunState = {
  accessGranted: true,
  invitation: "due",
  tour: {},
  songLinks: "none",
  accountAvailable: true,
  signedIn: false,
  visible: true,
  nowPlayingShown: false,
  cardOpen: false,
  showing: false,
};

describe("nextFirstRunStep", () => {
  it("offers song links only after Bring your music is answered", () => {
    const tour = { bringYourMusic: "due", songLinks: "due" } as const;
    assert.equal(nextFirstRunStep({ ...ready, tour }), "signInInvitation");
    assert.equal(nextFirstRunStep({ ...ready, tour, invitation: "done" }), "bringYourMusic");
    assert.equal(
      nextFirstRunStep({ ...ready, invitation: "done", tour: { ...tour, bringYourMusic: "done" } }),
      "songLinks",
    );
  });

  it("remembers song links unseen when all hosts are on, but offers it for some or none", () => {
    const linksReady = { ...ready, invitation: "done", tour: { songLinks: "due" } } as const;
    assert.equal(nextFirstRunStep({ ...linksReady, songLinks: "all" }), "rememberSongLinks");
    assert.equal(nextFirstRunStep({ ...linksReady, songLinks: "some" }), "songLinks");
    assert.equal(nextFirstRunStep({ ...linksReady, songLinks: "none" }), "songLinks");
    assert.equal(
      nextFirstRunStep({ ...linksReady, songLinks: "all", tour: { songLinks: "done" } }),
      "done",
    );
  });

  it("offers Bring your music after the invitation, including builds without accounts", () => {
    const tour = { bringYourMusic: "due" } as const;
    assert.equal(nextFirstRunStep({ ...ready, tour }), "signInInvitation");
    assert.equal(nextFirstRunStep({ ...ready, tour, invitation: "done" }), "bringYourMusic");
    assert.equal(nextFirstRunStep({ ...ready, tour, accountAvailable: false }), "bringYourMusic");
    assert.equal(nextFirstRunStep({ ...ready, tour, signedIn: true }), "remember");
    assert.equal(
      nextFirstRunStep({ ...ready, tour, invitation: "done", signedIn: true }),
      "bringYourMusic",
    );
  });

  it("waits before a tour card for access, foreground, Now Playing and other cards", () => {
    const tourReady: FirstRunState = {
      ...ready,
      invitation: "done",
      tour: { bringYourMusic: "due" },
    };
    assert.equal(nextFirstRunStep({ ...tourReady, accessGranted: false }), "access");
    assert.equal(nextFirstRunStep({ ...tourReady, visible: false }), "wait");
    assert.equal(nextFirstRunStep({ ...tourReady, nowPlayingShown: true }), "wait");
    assert.equal(nextFirstRunStep({ ...tourReady, cardOpen: true }), "wait");
    assert.equal(nextFirstRunStep({ ...tourReady, showing: true }), "wait");
    assert.equal(nextFirstRunStep(tourReady), "bringYourMusic");
    assert.equal(nextFirstRunStep({ ...tourReady, tour: { bringYourMusic: "done" } }), "done");
  });

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
