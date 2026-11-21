/**
 * #1359: what the Library's layer build ran on the JS thread before the first
 * screen, now its startup upkeep (`LibraryStore.startupUpkeep`). Times each
 * step over the fast-again fixture: the first pass (an upgrade's backfill)
 * and the median of eight passes after it (an ordinary start).
 */
import { creditSplits, relinkCreditsIfUnlinked } from "@wave/client/db/credits";
import { backfillRecordingTitles } from "@wave/client/db/matchingSong";
import { keyRecordings } from "@wave/client/db/sync";
import { watchTasteSources } from "@wave/client/db/tastePages";
import {
  createFastAgainFixture,
  FAST_AGAIN_DESKTOP,
  FAST_AGAIN_SIZES,
} from "@wave/client/testing/fastAgainFixture";

const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const ms = (value: number): number => Math.round(value * 100) / 100;

for (const size of FAST_AGAIN_SIZES) {
  const fixture = await createFastAgainFixture(size);
  const passes: Record<"relink" | "keys" | "titles" | "taste", number>[] = [];
  for (let pass = 0; pass < 9; pass++) {
    const at = [performance.now()];
    relinkCreditsIfUnlinked(fixture.db, creditSplits());
    at.push(performance.now());
    keyRecordings(fixture.db);
    at.push(performance.now());
    await backfillRecordingTitles(fixture.db);
    at.push(performance.now());
    watchTasteSources(fixture.db);
    at.push(performance.now());
    passes.push({
      relink: at[1]! - at[0]!,
      keys: at[2]! - at[1]!,
      titles: at[3]! - at[2]!,
      taste: at[4]! - at[3]!,
    });
  }
  const [first, ...rest] = passes;
  const steady = Object.fromEntries(
    (["relink", "keys", "titles", "taste"] as const).map((step) => [
      step,
      ms(median(rest.map((pass) => pass[step]))),
    ]),
  );
  console.log(
    JSON.stringify({
      size,
      first: Object.fromEntries(Object.entries(first!).map(([step, value]) => [step, ms(value)])),
      steady,
      steadyTotal: ms(
        median(rest.map((pass) => pass.relink + pass.keys + pass.titles + pass.taste)),
      ),
      note: FAST_AGAIN_DESKTOP,
    }),
  );
  fixture.close();
}
