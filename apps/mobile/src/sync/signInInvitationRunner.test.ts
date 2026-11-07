import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createSignInInvitationRunner,
  type SignInInvitationSurroundings,
} from "./signInInvitationRunner.ts";

/** One launch of Wave over [stored], the key-value store that outlives it. */
const launch = ({
  stored,
  accessGranted,
  usedBefore = false,
}: {
  stored: { value: string | null };
  accessGranted: boolean;
  usedBefore?: boolean;
}) => {
  const surroundings: {
    -readonly [K in keyof SignInInvitationSurroundings]: SignInInvitationSurroundings[K];
  } = {
    accessGranted,
    accountAvailable: true,
    signedIn: false,
    visible: true,
    nowPlayingShown: false,
    cardOpen: false,
  };
  const cards: { answer: () => void }[] = [];
  let finished = 0;
  const runner = createSignInInvitationRunner({
    stored: {
      get: () => stored.value,
      set: (value) => {
        stored.value = value;
      },
    },
    accessGrantedAtLaunch: accessGranted,
    usedBefore,
    surroundings: () => surroundings,
    show: (answered) => {
      surroundings.cardOpen = true;
      cards.push({
        answer: () => {
          surroundings.cardOpen = false;
          answered();
        },
      });
    },
    onFinished: () => {
      finished += 1;
    },
  });
  const grant = () => {
    surroundings.accessGranted = true;
    runner.reconsider();
  };
  return { runner, surroundings, cards, grant, finished: () => finished };
};

describe("the sign-in invitation", () => {
  it("shows once on a new install, after access is granted, and never again once answered", () => {
    const stored = { value: null as string | null };
    const first = launch({ stored, accessGranted: false });
    first.runner.reconsider();
    assert.equal(first.cards.length, 0, "not over the access screen");
    first.grant();
    assert.equal(first.cards.length, 1);
    first.runner.reconsider();
    assert.equal(first.cards.length, 1, "opened once");
    assert.equal(first.runner.isDue(), true);
    first.cards[0]!.answer();
    assert.equal(first.runner.isDue(), false);
    first.runner.reconsider();
    assert.equal(first.cards.length, 1);
    assert.equal(first.finished(), 1, "stops following the phone once answered");

    const next = launch({ stored, accessGranted: true });
    next.runner.reconsider();
    assert.equal(next.cards.length, 0);
  });

  it("comes back on the next launch when Wave closed before it was answered", () => {
    const stored = { value: null as string | null };
    const first = launch({ stored, accessGranted: false });
    first.grant();
    assert.equal(first.cards.length, 1);

    const next = launch({ stored, accessGranted: true });
    next.runner.reconsider();
    assert.equal(next.cards.length, 1);
  });

  it("never shows on a phone that used Wave before the update", () => {
    const stored = { value: null as string | null };
    const updated = launch({ stored, accessGranted: true });
    assert.equal(updated.runner.isDue(), false, "nothing to follow at startup");
    updated.runner.reconsider();
    assert.equal(updated.cards.length, 0);

    const revoked = launch({ stored: { value: null }, accessGranted: false, usedBefore: true });
    revoked.grant();
    assert.equal(revoked.cards.length, 0);
  });

  it("waits for another card to close", () => {
    const { runner, surroundings, cards, grant } = launch({
      stored: { value: null },
      accessGranted: false,
    });
    surroundings.cardOpen = true;
    grant();
    assert.equal(cards.length, 0);
    surroundings.cardOpen = false;
    runner.reconsider();
    assert.equal(cards.length, 1);
  });

  it("is done unseen when an account is already signed in", () => {
    const stored = { value: null as string | null };
    const first = launch({ stored, accessGranted: false });
    first.surroundings.signedIn = true;
    first.grant();
    assert.equal(first.cards.length, 0);
    assert.equal(stored.value, "done");
  });
});
