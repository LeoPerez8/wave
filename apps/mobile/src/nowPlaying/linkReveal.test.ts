import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveStreamedArtistLink,
  stepNowPlayingSheet,
  streamedArtistLink,
  type SheetPhase,
} from "@wave/core";
import { createTimingSession } from "../lib/timingSession.ts";
import { createTransitionFrames } from "../lib/transitionFrames.ts";
import { followStreamedArtistTap } from "../ytmusic/streamedArtistTap.ts";
import { nowPlayingLibraryArtistLink } from "./artistLink.ts";
import { createLinkRevealCompletion, followNowPlayingLink } from "./linkClose.ts";

const setup = (from: "Now Playing" | "menu" = "Now Playing") => {
  const session = createTimingSession({
    now: () => 0,
    wallNow: () => 0,
    write: () => {},
    context: () => ({ background: [], offline: false }),
    build: () => ({ version: "test", commit: "test" }),
  });
  const callbacks = new Map<number, () => void>();
  let nextFrame = 0;
  let uiStops = 0;
  const frames = createTransitionFrames({
    now: () => 0,
    request: (callback) => {
      callbacks.set(++nextFrame, callback);
      return nextFrame;
    },
    cancel: (id) => {
      callbacks.delete(id);
    },
    intervalMs: () => 1000 / 60,
    uiStart: () => {},
    uiStop: async () => {
      uiStops++;
      return null;
    },
    report: () => {},
  });
  session.onTransition(frames.transition);
  const phases: string[] = [];
  session.onTransition((event) => phases.push(event.phase));
  const draws: (() => void)[] = [];
  const completion = createLinkRevealCompletion({
    committed: (id) => {
      session.response(id);
      draws.push(() => {
        session.frame(id);
        session.content(id);
      });
    },
    end: session.end,
    current: () => session.active()?.id,
    dismiss: session.dismiss,
  });
  let released = 0;
  session.onSettled(() => {
    if (session.isSettled()) released++;
  });
  let id: number;
  if (from === "Now Playing") {
    id = session.begin("artistLink", "Justice");
    completion.begin(id);
  } else {
    // Artist 3's page is showing and settled; a song row on it is long-pressed or swiped.
    const page = session.routeCommitted("/library/artist/3")!;
    session.frame(page);
    session.content(page);
    session.end(page);
    assert.equal(session.isSettled(), true);
    released = 0;
    phases.length = 0;
    // YtSongActions / itemActions: `beginTiming("goToArtist", "Artist")`.
    id = session.begin("goToArtist", "Artist");
  }
  return {
    session,
    completion,
    id,
    draws,
    callbacks,
    frames,
    phases,
    released: () => released,
    uiStops: () => uiStops,
  };
};

/** Core's link for a streamed song credited to "Justice", before the link cache was read. */
const coldLink = () => {
  const context = { enabled: true, here: "/library/artist/3", libraryArtist: null };
  const link = streamedArtistLink(["Justice"], context)!;
  assert.equal(link.kind, "open");
  return { context, link };
};

/** `followStreamedArtistLink`'s terminal outcomes, wired as ArtistChoice wires them. */
const followCold = (
  h: ReturnType<typeof setup>,
  outcome: "here" | "YouTube Music off" | "lookup failed",
) => {
  const { context, link } = coldLink();
  return followStreamedArtistTap(link, {
    resolve: async (target) => {
      // `resolveStreamedArtistTap` answers undefined when YouTube Music was turned off.
      if (outcome === "YouTube Music off") return undefined;
      if (outcome === "lookup failed") throw new Error("runtime gone");
      return resolveStreamedArtistLink(target, context, {
        online: true,
        read: async () => (name) => (name === "Justice" ? { id: 3, name } : null),
      });
    },
    deliver: (resolved) => {
      if (resolved === undefined) h.completion.fail(h.id);
      else if (resolved.kind === "here") h.completion.reveal(h.id);
      else assert.fail(`expected here, got ${resolved.kind}`);
    },
  }).catch(() => h.completion.fail(h.id));
};

test("Go to Artist from a menu or swipe that resolves to the page you're on settles that page", async () => {
  const h = setup("menu");
  await followCold(h, "here");
  assert.equal(h.session.isSettled(), false, "the reveal still needs its frame");
  h.draws.shift()?.();
  assert.equal(h.session.active(), null);
  assert.equal(h.session.isSettled(), true);
  assert.equal(h.released(), 1, "settled-gated work runs again");
  assert.deepEqual(h.phases, ["start", "settled"]);
  assert.equal(h.callbacks.size, 0, "JS collector stops");
  assert.equal(h.uiStops(), 1, "UI collector stops");
  h.frames.dispose();
});

for (const outcome of ["YouTube Music off", "lookup failed"] as const) {
  test(`Go to Artist from a menu that opens nothing (${outcome}) lets the screen settle again`, async () => {
    const h = setup("menu");
    await followCold(h, outcome);
    assert.equal(h.session.active(), null);
    assert.equal(h.session.isSettled(), true);
    assert.equal(h.released(), 1);
    assert.deepEqual(h.phases, ["start", "cancelled"], "nothing opened, nothing measured");
    assert.equal(h.callbacks.size, 0);
    assert.equal(h.uiStops(), 1);
    assert.equal(h.draws.length, 0);
    h.frames.dispose();
  });
}

test("a Now Playing link that opens nothing settles once the sheet has hidden", () => {
  for (const hiddenFirst of [false, true]) {
    const h = setup();
    if (hiddenFirst) h.completion.hidden();
    h.completion.fail(h.id);
    assert.equal(h.session.isSettled(), hiddenFirst, "the closing sheet still moves");
    if (!hiddenFirst) h.completion.hidden();
    assert.equal(h.session.active(), null);
    assert.equal(h.session.isSettled(), true);
    assert.equal(h.released(), 1);
    assert.equal(h.callbacks.size, 0);
    assert.equal(h.uiStops(), 1);
    h.completion.fail(h.id);
    h.completion.hidden();
    assert.equal(h.released(), 1);
    h.frames.dispose();
  }
});

test("a late reveal or failure from a menu tap cannot end a newer tap", () => {
  const h = setup("menu");
  const next = h.session.begin("push", "/library/album/4");
  h.completion.reveal(h.id);
  h.completion.fail(h.id);
  assert.equal(h.session.active()?.id, next);
  assert.equal(h.session.isSettled(), false);
  assert.equal(h.draws.length, 0);
  h.frames.dispose();
});

for (const source of ["streamed", "local"] as const) {
  for (const closeFirst of [false, true]) {
    test(`cold ${source} artist resolving here settles with close ${closeFirst ? "before" : "after"} lookup`, async () => {
      const h = setup();
      let phase: SheetPhase = "open";
      const here = "/library/artist/3";
      const reveal = () => h.completion.reveal(h.id);
      let resolveRead!: () => void;
      const readReady = new Promise<void>((resolve) => {
        resolveRead = resolve;
      });
      let resolving!: Promise<void>;
      let released = 0;
      h.session.onSettled(() => {
        if (h.session.isSettled()) released++;
      });
      followNowPlayingLink({
        step: (event) => {
          const next = stepNowPlayingSheet(phase, event);
          phase = next.phase;
          return next;
        },
        navigate: () => {
          if (source === "local") {
            resolving = nowPlayingLibraryArtistLink({
              trackId: 9,
              details: null,
              here,
              read: async () => {
                await readReady;
                return { artistIds: [3] };
              },
              follow: () => assert.fail("already here"),
              reveal,
              unavailable: () => assert.fail("available"),
            }).open();
          } else {
            const context = { enabled: true, here, libraryArtist: null };
            const link = streamedArtistLink(["Justice"], context)!;
            assert.equal(link.kind, "open");
            resolving = followStreamedArtistTap(link, {
              resolve: (target) =>
                resolveStreamedArtistLink(target, context, {
                  online: true,
                  read: async () => {
                    await readReady;
                    return () => ({ id: 3, name: "Justice" });
                  },
                }),
              deliver: (target) => {
                assert.equal(target?.kind, "here");
                reveal();
              },
            });
          }
        },
      });
      assert.equal(phase, "closing");
      const close = () => {
        phase = stepNowPlayingSheet(phase, { type: "closed" }).phase;
        h.completion.hidden();
      };
      if (closeFirst) close();
      assert.equal(h.session.isSettled(), false);
      resolveRead();
      await resolving;
      assert.equal(h.session.isSettled(), false, "content still needs a frame");
      h.draws.shift()?.();
      assert.equal(h.session.isSettled(), closeFirst);
      if (!closeFirst) close();
      assert.equal(phase, "hidden");
      assert.equal(h.session.active(), null);
      assert.equal(h.session.isSettled(), true);
      assert.equal(released, 1);
      assert.equal(h.callbacks.size, 0, "JS collector stops at settlement");
      assert.equal(h.uiStops(), 1, "UI collector stops at settlement");
      h.completion.reveal(h.id);
      h.completion.hidden();
      assert.equal(released, 1);
      h.frames.dispose();
    });
  }
}

test("a pushed destination keeps its timing independent of sheet completion", () => {
  const h = setup();
  h.completion.hidden();
  assert.equal(h.session.active()?.id, h.id);
  assert.equal(h.session.isSettled(), false);
  assert.equal(h.draws.length, 0);
  h.session.response(h.id);
  h.session.frame(h.id);
  h.session.content(h.id);
  assert.equal(h.session.isSettled(), false);
  h.session.end(h.id);
  assert.equal(h.session.isSettled(), true);
  h.frames.dispose();
});

test("late resolutions and draw callbacks cannot settle a newer link", () => {
  const h = setup();
  h.completion.reveal(h.id);
  const next = h.session.begin("artistLink", "Another artist");
  h.completion.begin(next);
  h.completion.reveal(h.id);
  h.completion.hidden();
  h.draws.shift()?.();
  assert.equal(h.session.active()?.id, next);
  assert.equal(h.session.isSettled(), false);
  assert.equal(h.draws.length, 0);
  h.frames.dispose();
});
