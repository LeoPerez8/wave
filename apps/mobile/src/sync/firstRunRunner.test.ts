import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFirstRunRunner, type FirstRunSurroundings } from "./firstRunRunner.ts";

/** One launch of Wave over [stored], the key-value store that outlives it. */
const launch = ({
  stored,
  accessGranted,
  usedBefore = false,
  tourStored = { value: "done" as string | null },
}: {
  stored: { value: string | null };
  accessGranted: boolean;
  usedBefore?: boolean;
  tourStored?: { value: string | null };
}) => {
  const surroundings: {
    -readonly [K in keyof FirstRunSurroundings]: FirstRunSurroundings[K];
  } = {
    accessGranted,
    accountAvailable: true,
    signedIn: false,
    visible: true,
    nowPlayingShown: false,
    cardOpen: false,
  };
  const cards: { answer: () => void }[] = [];
  const tourCards: { finish: (answer: "due" | "done") => void }[] = [];
  let finished = 0;
  const runner = createFirstRunRunner({
    stored: {
      get: () => stored.value,
      set: (value) => {
        stored.value = value;
      },
    },
    tourStored: {
      get: () => tourStored.value,
      set: (_card, value) => {
        tourStored.value = value;
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
    showTourCard: (_card, finish) => {
      surroundings.cardOpen = true;
      tourCards.push({
        finish: (answer) => {
          surroundings.cardOpen = false;
          finish(answer);
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
  return { runner, surroundings, cards, tourCards, grant, finished: () => finished };
};

describe("the first-run tour", () => {
  it("still runs without the sync service or when the invitation remembers an account", () => {
    for (const accountAvailable of [true, false]) {
      const first = launch({
        stored: { value: null },
        tourStored: { value: null },
        accessGranted: false,
      });
      first.surroundings.accountAvailable = accountAvailable;
      first.surroundings.signedIn = accountAvailable ? true : null;
      first.grant();
      assert.equal(first.cards.length, 0);
      assert.equal(first.tourCards.length, 1);
    }
  });

  it("never starts card 1 on an update, including a phone with access revoked", () => {
    for (const prior of [
      { accessGranted: true, usedBefore: false, invitation: null },
      { accessGranted: false, usedBefore: true, invitation: null },
      { accessGranted: false, usedBefore: false, invitation: "due" },
      { accessGranted: false, usedBefore: false, invitation: "done" },
    ]) {
      const tourStored = { value: null as string | null };
      const updated = launch({ stored: { value: prior.invitation }, tourStored, ...prior });
      updated.grant();
      updated.cards[0]?.answer();
      assert.equal(updated.tourCards.length, 0);
      assert.equal(tourStored.value, "done");
    }
  });

  it("waits through sign-in and the picker, returns after either closes, and resumes next launch unanswered", () => {
    const stored = { value: null as string | null };
    const tourStored = { value: null as string | null };
    const first = launch({ stored, tourStored, accessGranted: false });
    first.grant();
    first.cards[0]!.answer();
    first.surroundings.cardOpen = false; // The card has left for a native sign-in or picker.
    first.runner.reconsider();
    assert.equal(first.tourCards.length, 1, "doesn't reopen over sign-in");
    first.surroundings.nowPlayingShown = true;
    first.tourCards[0]!.finish("due");
    assert.equal(first.tourCards.length, 1, "still waits for Now Playing");
    first.surroundings.nowPlayingShown = false;
    first.runner.reconsider();
    assert.equal(first.tourCards.length, 2);
    assert.equal(tourStored.value, "due", "importing isn't an answer");
    const next = launch({ stored, tourStored, accessGranted: true, usedBefore: true });
    next.runner.reconsider();
    assert.equal(next.cards.length, 0);
    assert.equal(next.tourCards.length, 1);
  });

  it("follows the invitation and remembers its own answer across launches", () => {
    const stored = { value: null as string | null };
    const tourStored = { value: null as string | null };
    const first = launch({ stored, tourStored, accessGranted: false });
    assert.equal(tourStored.value, "due", "settled before all-files access changes");
    first.grant();
    assert.equal(first.cards.length, 1);
    assert.equal(first.tourCards.length, 0);
    first.cards[0]!.answer();
    assert.equal(first.tourCards.length, 1);
    assert.equal(first.finished(), 0, "keeps following until the tour is answered");
    first.tourCards[0]!.finish("done");
    assert.equal(tourStored.value, "done");
    assert.equal(first.finished(), 1);
    const next = launch({ stored, tourStored, accessGranted: true });
    next.runner.reconsider();
    assert.equal(next.tourCards.length, 0);
  });
});

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
