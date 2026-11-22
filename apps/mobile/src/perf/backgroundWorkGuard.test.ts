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

test("every stepped work runs under a name (#1447)", () => {
  // The name is a service with no default: stepped work no caller names doesn't typecheck,
  // and so never logs its blocks as unnamed.
  const stepped = sources["lib/stepped.ts"]!;
  assert.match(stepped, /class BackgroundWorkName extends Context\.Service</);
  assert.doesNotMatch(stepped, /Context\.Reference/);
  const fallbacks = Object.entries(sources)
    .filter(([, text]) => text.includes("unnamed background work"))
    .map(([path]) => path);
  assert.deepEqual(fallbacks, [], "name the work instead of giving it a fallback");
  // Names come only through `namedWork`; tests' runners stay out of the app.
  const providers = Object.entries(sources)
    .filter(([, text]) => /provideService\(\s*BackgroundWorkName\b/.test(text))
    .map(([path]) => path)
    .sort();
  assert.deepEqual(providers, ["lib/stepped.ts", "lib/steppedTesting.ts"]);
  const testRunners = Object.entries(sources)
    .filter(([, text]) => /\bsteppedTesting\b/.test(text))
    .map(([path]) => path);
  assert.deepEqual(testRunners, [], "lib/steppedTesting.ts is for tests and benches only");
});

test("turns and slices taken outside an Effect carry a name at each call site (#1447)", () => {
  const scheduler = sources["lib/backgroundWork.ts"]!;
  for (const helper of ["inSlice", "namedAsyncWork", "whenFree", "freeTurn", "startupTurn"]) {
    const signature = new RegExp(`export const ${helper} = [^\n]*`).exec(scheduler)?.[0];
    assert.ok(signature !== undefined, `lib/backgroundWork.ts no longer exports ${helper}`);
    assert.match(signature, /\bname: string\b/, `${helper} takes the work's name`);
    assert.doesNotMatch(
      signature,
      /\bname\??\s*(?::\s*string\s*)?=|\bname\?:/,
      `${helper}'s name has no default`,
    );
  }
  // A host's own `freeTurn` method (the client's playlist visit) gets its name where the app
  // supplies it, so only the app's helpers count here.
  const bare = Object.entries(sources)
    .filter(([, text]) =>
      /(?<![.\w])(?:freeTurn|startupTurn)\(\s*\)|\bnamedWork\(\s*(?:""|'')\s*\)/.test(text),
    )
    .map(([path]) => path);
  assert.deepEqual(bare, []);
});

test("the sliced work #1448 and #1453 added runs under its own name", () => {
  assert.match(sources["library/backgroundFill.ts"]!, /namedWork\(FILL_WORK\)/);
  assert.match(sources["ytmusic/YtDownloads.ts"]!, /freeTurn\(RESUME_WORK\)/);
  assert.match(sources["playback/MagicQueue.ts"]!, /namedWork\("Magic Queue batch"\)/);
});
