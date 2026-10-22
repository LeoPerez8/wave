import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  closingSpringSettleMs,
  LINK_SEQUENCES,
  replayLinks,
  type SheetReducer,
} from "../nowPlayingLinksReplay.ts";
import type { followNowPlayingLink } from "../../../src/nowPlaying/linkClose.ts";
import type { FastAgainBench } from "../types.ts";

/** Real selected-revision Core, with its app's immediate action or faithful ti slot adapter. */
export const bench: FastAgainBench = {
  name: "nowPlayingLinks",
  async run(context) {
    const source = readFileSync(join(context.root, "apps/mobile/src/nowPlaying/sheet.ts"), "utf8");
    const parameters = source.match(
      /const SPRING = \{ damping: ([\d.]+), stiffness: ([\d.]+), mass: ([\d.]+) \}/,
    );
    assert.ok(parameters, "selected revision must expose its actual closing spring parameters");
    const spring = {
      damping: Number(parameters[1]),
      stiffness: Number(parameters[2]),
      mass: Number(parameters[3]),
    };
    const settleMs = closingSpringSettleMs(spring);
    const { stepNowPlayingSheet } = await context.loadModule<{ stepNowPlayingSheet: SheetReducer }>(
      "packages/core/src/sheetLifecycle.ts",
    );
    const immediate = existsSync(join(context.root, "apps/mobile/src/nowPlaying/linkClose.ts"));
    const follow = immediate
      ? (
          await context.loadModule<{ followNowPlayingLink: typeof followNowPlayingLink }>(
            "apps/mobile/src/nowPlaying/linkClose.ts",
          )
        ).followNowPlayingLink
      : undefined;
    if (!immediate) {
      // Refuse to call an unknown historical implementation a measured baseline.
      assert.match(source, /afterClose = then \?\? null/);
      assert.match(source, /if \(next.hidden\) \{[\s\S]*?runAfterClose\(\)/);
      assert.match(source, /if \(phase.get\(\) === "hidden"\) runAfterClose\(\)/);
    }
    return LINK_SEQUENCES.map((sequence) => {
      const replay = () => replayLinks(stepNowPlayingSheet, sequence, settleMs, follow);
      const result = replay();
      const delivered = result.pushes.map((p) => p.tap);
      assert.deepEqual(
        delivered,
        delivered.toSorted((a, b) => a - b),
      );
      assert.equal(new Set(delivered).size, delivered.length);
      assert.ok(delivered.every((tap) => tap >= 1 && tap <= result.taps));
      if (immediate) {
        assert.equal(result.lost, 0);
        assert.ok(result.pushes.every((p) => p.waitMs === 0));
      }
      return context.measure(sequence.name, replay, {
        details: {
          source: immediate
            ? "selected revision's Core lifecycle + actual followNowPlayingLink"
            : "selected revision's Core lifecycle + faithful ti closeNowPlaying single-slot replay",
          taps: result.taps,
          tapsLost: result.lost,
          pushes: result.pushes.length,
          waitBeforePushMs: result.pushes.map((p) => p.waitMs),
          closingSpring: spring,
          springSettleMs: settleMs,
          energyThreshold: 6e-9,
          modeledRefreshHz: 60,
          eventsApartMs: 16,
          timeSemantics:
            "CPU/wall measure synchronous replay only; push wait is analytic spring time, not device evidence",
          expectedDestinations: result.taps,
          resultCheck:
            "delivered tap identity/order verified; after must deliver every tap at once; missing baseline deliveries intentionally differ, so no common resultKey",
        },
      });
    });
  },
};
