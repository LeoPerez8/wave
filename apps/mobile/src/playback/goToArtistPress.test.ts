import assert from "node:assert/strict";
import test from "node:test";
import type { ItemActionEntry } from "@wave/core";
import { createTimingSession } from "../lib/timingSession.ts";
import { goToArtistPress } from "./goToArtistPress.ts";

/** A settled artist page, as the page shows once its opening has ended. */
const settledPage = () => {
  const session = createTimingSession({
    now: () => 0,
    wallNow: () => 0,
    write: () => {},
    context: () => ({ background: [], offline: false }),
    build: () => ({ version: "test", commit: "test" }),
  });
  const page = session.routeCommitted("/library/artist/3")!;
  session.frame(page);
  session.content(page);
  session.end(page);
  assert.equal(session.isSettled(), true);
  return session;
};

type Entry = Extract<ItemActionEntry<{ id: number; name: string }>, { action: "goToArtist" }>;
const library: Entry = { action: "goToArtist", artists: { kind: "open", artistId: 7 } };
const streamed: Entry = {
  action: "goToArtist",
  streamedArtists: { kind: "open", target: { kind: "yt", name: "Justice" } },
};

const wire = (session: ReturnType<typeof settledPage>) => {
  const steps: string[] = [];
  return {
    steps,
    wiring: {
      begin: () => {
        steps.push("begin");
        session.begin("goToArtist", "Artist");
      },
      run: (action: () => void) => () => {
        steps.push("finish");
        action();
      },
      follow: () => steps.push("follow"),
      followStreamed: () => steps.push("followStreamed"),
    },
  };
};

test("building Go to Artist's entry leaves the screen settled (#663)", () => {
  for (const entry of [library, streamed]) {
    const session = settledPage();
    const { steps, wiring } = wire(session);
    goToArtistPress(entry, wiring);
    assert.deepEqual(steps, []);
    assert.equal(session.active(), null);
    assert.equal(session.isSettled(), true);
  }
});

test("pressing Go to Artist starts its timing, then finishes and follows the link", () => {
  const session = settledPage();
  const { steps, wiring } = wire(session);
  goToArtistPress(library, wiring)();
  assert.equal(session.active()?.kind, "goToArtist");
  assert.equal(session.isSettled(), false);
  assert.deepEqual(steps, ["begin", "finish", "follow"]);

  const again = settledPage();
  const streamedWire = wire(again);
  goToArtistPress(streamed, streamedWire.wiring)();
  assert.equal(again.active()?.kind, "goToArtist");
  assert.deepEqual(streamedWire.steps, ["begin", "finish", "followStreamed"]);
});
