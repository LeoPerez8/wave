/**
 * #1350's desktop guard: background work runs through the one scheduler
 * (`lib/backgroundWork.ts`), which keeps its slices within 8 ms and holds
 * them while a tap's transition runs. Work that defers itself another way
 * (a zero timer, an idle callback, InteractionManager) runs outside it.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { BACKGROUND_JOBS, OWN_DEFERRALS } from "./performancePolicy.ts";
import { mobileSources } from "./sourceAudit.mjs";

const sources: Record<string, string> = mobileSources(join(import.meta.dirname, ".."));

/** Ways to put work off to a later turn without asking the scheduler. */
const DEFERRAL =
  /\bInteractionManager\b|\brequestIdleCallback\s*\(|\bsetImmediate\s*\(|\bqueueMicrotask\s*\(|\bsetTimeout\s*\(\s*[\w.]+\s*,\s*0\s*\)|\bsetTimeout\s*\(\s*\([^()]*\)\s*=>[^;]*?,\s*0\s*\)/;

test("no module defers work past the background scheduler, but the reviewed ones", () => {
  const found = Object.entries(sources)
    .filter(([path, text]) => path !== "lib/backgroundWork.ts" && DEFERRAL.test(text))
    .map(([path]) => path);
  const unreviewed = found.filter((path) => OWN_DEFERRALS[path] === undefined);
  assert.deepEqual(
    unreviewed,
    [],
    "take a turn from lib/backgroundWork.ts (whenFree, freeTurn, freeTurnEffect) instead",
  );
  for (const [path, { reason }] of Object.entries(OWN_DEFERRALS)) {
    assert.ok(found.includes(path), `${path} no longer defers on its own: drop its entry`);
    assert.ok(reason.trim().length > 30, `${path} needs a reviewable reason`);
  }
});

test("only the scheduler makes background work and runs its slices", () => {
  const makers = Object.entries(sources)
    .filter(([, text]) => /\bcreateBackgroundWork\s*\(/.test(text))
    .map(([path]) => path);
  assert.deepEqual(makers, ["lib/backgroundWork.ts"]);
  const slicers = Object.entries(sources)
    .filter(([, text]) => /\brunStepSlice\s*\(/.test(text))
    .map(([path]) => path);
  assert.deepEqual(slicers, ["lib/stepped.ts"]);
});

test("each background job the ticket names takes its turns from the scheduler", () => {
  for (const [path, { turns }] of Object.entries(BACKGROUND_JOBS)) {
    const text = sources[path];
    assert.ok(text !== undefined, `${path} is gone: update BACKGROUND_JOBS`);
    const name = turns.replace("lib/", "");
    const imports = [
      `"@/${turns}"`,
      `"../${turns}"`,
      `"../${turns}.ts"`,
      `"./${name}"`,
      `"./${name}.ts"`,
    ];
    assert.ok(
      imports.some((source) => text.includes(`from ${source}`)),
      `${path} must take its turns from ${turns}`,
    );
  }
});
