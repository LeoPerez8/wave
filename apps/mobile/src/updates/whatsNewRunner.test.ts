import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PublishedRelease } from "@wave/core";
import * as Effect from "effect/Effect";

import { createWhatsNewRunner, type WhatsNewSurroundings } from "./whatsNewRunner.ts";

const release: PublishedRelease = {
  version: "0.47.0",
  notes: {
    en: { new: ["A"], fixes: [] },
    "pt-BR": { new: ["B"], fixes: [] },
  },
};

const settle = () => new Promise((resolve) => setTimeout(resolve));

/** A runner over a stored seen version and a scripted service, standing for one launch of Wave. */
const launch = ({
  seen,
  answer = Effect.succeed([release]),
}: {
  seen: { value: string | null };
  answer?: Effect.Effect<readonly PublishedRelease[], unknown>;
}) => {
  const asked: string[] = [];
  const logged: string[] = [];
  const cards: { dismiss: () => void; hidden: boolean }[] = [];
  const surroundings: { -readonly [K in keyof WhatsNewSurroundings]: WhatsNewSurroundings[K] } = {
    visible: true,
    nowPlayingShown: false,
    cardOpen: false,
  };
  let now = 1_000_000_000;
  let finished = 0;
  const runner = createWhatsNewRunner({
    runningVersion: "0.47.0",
    seenVersion: {
      get: () => seen.value,
      set: (version) => {
        seen.value = version;
      },
    },
    fetchNotes: (from, to) => {
      asked.push(`${from}..${to}`);
      return answer;
    },
    surroundings: () => surroundings,
    show: (_, dismissed) => {
      const card = { dismiss: dismissed, hidden: false };
      cards.push(card);
      surroundings.cardOpen = true;
      return () => {
        card.hidden = true;
        surroundings.cardOpen = false;
        // As the real card does: closing it tells whoever follows the overlays, at once.
        runner.reconsider();
      };
    },
    now: () => now,
    log: (_, message) => logged.push(message),
    onFinished: () => finished++,
  });
  return {
    runner,
    asked,
    logged,
    cards,
    surroundings,
    finishedCount: () => finished,
    later: (ms: number) => {
      now += ms;
    },
  };
};

describe("What's New", () => {
  it("shows nothing on a fresh install, and remembers the version", async () => {
    const seen = { value: null };
    const app = launch({ seen });
    app.runner.reconsider();
    await settle();
    assert.equal(seen.value, "0.47.0");
    assert.deepEqual(app.asked, []);
    assert.equal(app.cards.length, 0);
    assert.equal(app.finishedCount(), 1);
  });

  it("asks for what came after the seen version and opens one card", async () => {
    const app = launch({ seen: { value: "0.46.2" } });
    app.runner.reconsider();
    await settle();
    app.runner.reconsider();
    await settle();
    assert.deepEqual(app.asked, ["0.46.2..0.47.0"]);
    assert.equal(app.cards.length, 1);
  });

  it("doesn't return after being dismissed, in this launch or the next", async () => {
    const seen = { value: "0.46.2" };
    const app = launch({ seen });
    app.runner.reconsider();
    await settle();
    app.cards[0]?.dismiss();
    assert.equal(seen.value, "0.47.0");
    assert.equal(app.finishedCount(), 1);
    app.runner.reconsider();
    await settle();
    assert.equal(app.cards.length, 1);

    const next = launch({ seen });
    next.runner.reconsider();
    await settle();
    assert.deepEqual(next.asked, []);
    assert.equal(next.cards.length, 0);
  });

  it("comes back after a JS reload that came before the dismissal", async () => {
    const seen = { value: "0.46.2" };
    const app = launch({ seen });
    app.runner.reconsider();
    await settle();
    assert.equal(app.cards.length, 1);
    assert.equal(seen.value, "0.46.2");

    const reloaded = launch({ seen });
    reloaded.runner.reconsider();
    await settle();
    assert.equal(reloaded.cards.length, 1);
  });

  it("waits for Wave to be visible, as after a reload in the background", async () => {
    const app = launch({ seen: { value: "0.46.2" } });
    app.surroundings.visible = false;
    app.runner.reconsider();
    await settle();
    assert.deepEqual(app.asked, []);
    app.surroundings.visible = true;
    app.runner.reconsider();
    await settle();
    assert.equal(app.cards.length, 1);
  });

  it("holds the card while Now Playing is up, and opens it once it's gone", async () => {
    const app = launch({ seen: { value: "0.46.2" } });
    app.surroundings.nowPlayingShown = true;
    app.runner.reconsider();
    await settle();
    assert.equal(app.cards.length, 0);
    app.surroundings.nowPlayingShown = false;
    app.runner.reconsider();
    assert.equal(app.cards.length, 1);
  });

  it("takes an open card down when Now Playing comes up, and brings it back unseen", async () => {
    const seen = { value: "0.46.2" };
    const app = launch({ seen });
    app.runner.reconsider();
    await settle();
    app.surroundings.nowPlayingShown = true;
    app.runner.reconsider();
    assert.equal(app.cards[0]?.hidden, true);
    assert.equal(seen.value, "0.46.2");
    app.surroundings.nowPlayingShown = false;
    app.runner.reconsider();
    assert.equal(app.cards.length, 2);
    assert.deepEqual(app.asked, ["0.46.2..0.47.0"]);
  });

  it("shows nothing and raises nothing when the fetch fails, then asks again later", async () => {
    const seen = { value: "0.46.2" };
    const app = launch({ seen, answer: Effect.fail(new Error("offline")) });
    app.runner.reconsider();
    await settle();
    assert.equal(app.cards.length, 0);
    assert.equal(seen.value, "0.46.2");
    assert.match(app.logged.join("\n"), /offline/);
    app.runner.reconsider();
    await settle();
    assert.equal(app.asked.length, 1);
    app.later(15 * 60_000);
    app.runner.reconsider();
    await settle();
    assert.equal(app.asked.length, 2);
  });

  it("moves on with nothing to show when the notes have nothing to say", async () => {
    const seen = { value: "0.46.2" };
    const app = launch({ seen, answer: Effect.succeed([]) });
    app.runner.reconsider();
    await settle();
    assert.equal(seen.value, "0.47.0");
    assert.equal(app.cards.length, 0);
    assert.equal(app.finishedCount(), 1);
  });
});
