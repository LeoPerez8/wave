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

const setup = () => {
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
  });
  const id = session.begin("artistLink", "Justice");
  completion.begin(id);
  return { session, completion, id, draws, callbacks, frames, uiStops: () => uiStops };
};

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
