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
  tourStored?: { value: string | null; songLinks?: string | null };
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
    whatsNewPending: false,
    readSongLinks: () => "none",
  };
  const cards: { answer: () => void }[] = [];
  const tourCards: { card: string; finish: (answer: "due" | "done") => void }[] = [];
  let finished = 0;
  const runner = createFirstRunRunner({
    stored: {
      get: () => stored.value,
      set: (value) => {
        stored.value = value;
      },
    },
    tourStored: {
      get: (card) =>
        card === "songLinks"
          ? "songLinks" in tourStored
            ? tourStored.songLinks!
            : "done"
          : tourStored.value,
      set: (card, value) => {
        if (card === "songLinks") tourStored.songLinks = value;
        else tourStored.value = value;
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
    showTourCard: (card, finish) => {
      surroundings.cardOpen = true;
      tourCards.push({
        card,
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
  it("settles both cards before access, resumes an unanswered card 2, and keeps its answer", () => {
    const stored = { value: null as string | null };
    const tourStored = { value: null as string | null, songLinks: null as string | null };
    const first = launch({ stored, tourStored, accessGranted: false });
    assert.equal(tourStored.songLinks, "due");
    first.grant();
    first.cards[0]!.answer();
    first.tourCards[0]!.finish("done");
    assert.deepEqual(
      first.tourCards.map(({ card }) => card),
      ["bringYourMusic", "songLinks"],
    );
    assert.equal(tourStored.songLinks, "due", "showing isn't an answer");
    const next = launch({ stored, tourStored, accessGranted: true });
    next.runner.reconsider();
    assert.deepEqual(
      next.tourCards.map(({ card }) => card),
      ["songLinks"],
    );
    next.tourCards[0]!.finish("done");
    assert.equal(tourStored.songLinks, "done");
    assert.equal(next.finished(), 1);
    const answered = launch({ stored, tourStored, accessGranted: true });
    answered.runner.reconsider();
    assert.equal(answered.tourCards.length, 0);
  });

  it("counts an all-on song-links card as answered without showing it, across launches", () => {
    const stored = { value: null as string | null };
    const tourStored = { value: null as string | null, songLinks: "due" as string | null };
    const first = launch({ stored, tourStored, accessGranted: false });
    first.grant();
    first.cards[0]!.answer();
    first.surroundings.readSongLinks = () => "all";
    first.tourCards[0]!.finish("done");
    assert.deepEqual(
      first.tourCards.map(({ card }) => card),
      ["bringYourMusic"],
    );
    assert.equal(tourStored.songLinks, "done");
    const next = launch({ stored, tourStored, accessGranted: true });
    next.runner.reconsider();
    assert.equal(next.tourCards.length, 0, "stays answered even if links are later turned off");
  });

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

  it("brings an update only song links, including a phone with access revoked", () => {
    for (const prior of [
      { accessGranted: true, usedBefore: false, invitation: null },
      { accessGranted: false, usedBefore: true, invitation: null },
      { accessGranted: false, usedBefore: false, invitation: "due" },
      { accessGranted: false, usedBefore: false, invitation: "done" },
    ]) {
      const tourStored = { value: null as string | null, songLinks: null as string | null };
      const updated = launch({ stored: { value: prior.invitation }, tourStored, ...prior });
      updated.grant();
      updated.cards[0]?.answer();
      assert.deepEqual(
        updated.tourCards.map(({ card }) => card),
        ["songLinks"],
      );
      assert.equal(tourStored.value, "done");
    }
  });

  it("offers song links to an updated phone once, after What's New closes", () => {
    const stored = { value: null as string | null };
    const tourStored = { value: null as string | null, songLinks: null as string | null };
    const first = launch({ stored, tourStored, accessGranted: true });
    assert.equal(first.runner.isDue(), true);
    first.surroundings.whatsNewPending = true;
    first.runner.reconsider();
    assert.equal(first.tourCards.length, 0, "not before What's New");
    first.surroundings.whatsNewPending = false;
    first.runner.reconsider();
    assert.deepEqual(
      first.tourCards.map(({ card }) => card),
      ["songLinks"],
    );
    first.tourCards[0]!.finish("done");
    assert.equal(tourStored.songLinks, "done");
    assert.equal(first.finished(), 1);
    const next = launch({ stored, tourStored, accessGranted: true });
    assert.equal(next.runner.isDue(), false);
    next.runner.reconsider();
    assert.equal(next.tourCards.length, 0);
  });

  it("shows an updated phone's song links again next launch when it wasn't answered", () => {
    const stored = { value: null as string | null };
    const tourStored = { value: null as string | null, songLinks: null as string | null };
    const first = launch({ stored, tourStored, accessGranted: true });
    first.runner.reconsider();
    assert.equal(first.tourCards.length, 1);
    const next = launch({ stored, tourStored, accessGranted: true });
    next.runner.reconsider();
    assert.deepEqual(
      next.tourCards.map(({ card }) => card),
      ["songLinks"],
    );
  });

  it("answers an updated phone's song links unseen when some or all links are on", () => {
    for (const songLinks of ["some", "all"] as const) {
      const stored = { value: null as string | null };
      const tourStored = { value: null as string | null, songLinks: null as string | null };
      const updated = launch({ stored, tourStored, accessGranted: true });
      updated.surroundings.readSongLinks = () => songLinks;
      updated.runner.reconsider();
      assert.equal(updated.tourCards.length, 0);
      assert.equal(tourStored.songLinks, "done");
      assert.equal(updated.finished(), 1);
    }
  });

  it("leaves song links due on an APK that can't read them, for a later build to offer", () => {
    for (const prior of [
      { stored: null, songLinks: null, accessGranted: true },
      { stored: "done", songLinks: "due", accessGranted: true },
    ]) {
      const stored = { value: prior.stored as string | null };
      const tourStored = {
        value: "done" as string | null,
        songLinks: prior.songLinks as string | null,
      };
      const kept = launch({ stored, tourStored, accessGranted: prior.accessGranted });
      kept.surroundings.readSongLinks = () => null;
      kept.runner.reconsider();
      assert.equal(kept.tourCards.length, 0);
      assert.equal(kept.finished(), 1);
      assert.notEqual(tourStored.songLinks, "done");
      const rebuilt = launch({ stored, tourStored, accessGranted: true });
      rebuilt.runner.reconsider();
      assert.deepEqual(
        rebuilt.tourCards.map(({ card }) => card),
        ["songLinks"],
      );
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
