import { createHash } from "node:crypto";
import { traceQueries } from "../../../src/library/db/testDatabase.ts";
import { seedArtistOpening } from "../artistOpeningFixture.ts";
import { loadArtistOpening } from "../artistOpeningReplay.ts";
import type { BenchMeasurement, FastAgainBench } from "../types.ts";

const key = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const bench: FastAgainBench = {
  name: "artistOpening",
  async run(context) {
    const opening = await loadArtistOpening(context.root, context.fixture.db);
    const restore = seedArtistOpening(context.fixture, opening);
    try {
      const measurements: BenchMeasurement[] = [];
      for (const target of [context.fixture.targets.small, context.fixture.targets.large]) {
        for (const integrated of [false, true]) {
          const label = `${target.songIds.length}/${integrated ? "integrated" : "library"}`;
          const run = () => opening.open(target.artistId, context.fixture.now, integrated);
          const { queries, result } = traceQueries(context.fixture.db, run);
          const songRows = queries
            .filter((q) => /(?:"tracks"|tracks)\.(?:"title"|title)/.test(q.sql))
            .reduce((sum, q) => sum + q.rows, 0);
          measurements.push(
            context.measure(`${label}/firstRows`, () => opening.localPage(run()), {
              resultKey: key,
              details: {
                source: "faithful opening replay; actual selected-worktree LibraryStore and Core",
                phase:
                  "tap to local first-row data ready; excludes RN layout, navigation, module loading and fixture setup",
                cache: "cold shared query/finder per opening; DB/module warmed",
                savedPopular: true,
                appearsOn: result.detail.appearsOn.length,
                songRows,
                reads: queries.map((q) => ({ sql: q.sql, rows: q.rows })),
                finder: opening.fixed
                  ? "deferred until settled online additions"
                  : "whole Library on opening (ti)",
              },
            }),
          );
          // Independent settled-page equality, including what YT adds. This is
          // deliberately separate from time-to-first-local-rows: after defers it.
          measurements.push(
            context.measure(
              `${label}/settledPage`,
              () => opening.settle(result, context.fixture.now, integrated),
              {
                resultKey: key,
                details: {
                  phase:
                    "settled page derivation/deferred finder; existing first-row payload reused",
                  semanticEquality:
                    "complete artist/albums/appearsOn/songs/ranks/counts/online shelves and page items",
                  notifications: "read-only service; no subscriber writes",
                },
              },
            ),
          );
        }
      }
      return measurements;
    } finally {
      restore();
    }
  },
};
