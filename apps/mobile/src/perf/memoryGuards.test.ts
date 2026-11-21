import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { parseTabScreens } from "@wave/core";

import { MODULE_COLLECTIONS } from "./performancePolicy.ts";
import { mobileSources } from "./sourceAudit.mjs";

// Memory (docs/spec.md › Fluidity, #1358): hidden tabs stay frozen, and every
// collection a module keeps for the session says what bounds it (Performance
// rules, 12).

const app = join(import.meta.dirname, "..", "..");
const repo = join(app, "..", "..");
const sources = mobileSources(join(app, "src"));

test("a hidden tab is frozen by default: it renders nothing and follows no store (#1358)", () => {
  const screens = parseTabScreens(undefined);
  assert.equal(screens.freeze, true);
  assert.equal(screens.detach, true);
  assert.equal(screens.followHidden, false);
  const tabs = sources["chrome/tabScreens.tsx"]!;
  assert.match(tabs, /parseTabScreens\(process\.env\.EXPO_PUBLIC_WAVE_TABS\)/);
  assert.match(tabs, /freezeOnBlur=\{TAB_SCREENS\.freeze\}/);
  assert.match(tabs, /activityState=\{isFocused \? 2 : 0\}/);
});

test("no release build picks how hidden tabs are kept: only a perf comparison bundle does", () => {
  const workflows = join(repo, ".github", "workflows");
  const files = [
    ...readdirSync(workflows).map((name) => join(workflows, name)),
    join(app, "eas.json"),
    join(app, "app.config.ts"),
    join(app, "app.json"),
  ].filter((path) => existsSync(path));
  const setting = files.filter((path) => readFileSync(path, "utf8").includes("WAVE_TABS"));
  assert.deepEqual(setting, []);
});

/** Module-level collections, `path#name`: what a module keeps for the whole session. */
const moduleCollections = (files: Record<string, string>): string[] =>
  Object.entries(files).flatMap(([path, source]) =>
    [
      ...source.matchAll(
        /^(?:export )?(?:const|let) (\w+)(?:: ([^=\n]+))? = (?:new (?:Map|Set)\b|knownPages\b)/gm,
      ),
    ]
      // A fixed lookup table, or the set of a store's listeners (bounded by who listens).
      .filter(([, , type]) => !/^Readonly(Map|Set)</.test(type ?? ""))
      .filter(([, name]) => !/(^l|L)isteners$|^followers$/.test(name!))
      .map(([, name]) => `${path}#${name}`),
  );

test("every collection a module keeps says what bounds it (Performance rules, 12)", () => {
  const found = moduleCollections(sources).sort();
  const listed = Object.keys(MODULE_COLLECTIONS).sort();
  assert.deepEqual(
    found.filter((owner) => !listed.includes(owner)),
    [],
    "add the collection to MODULE_COLLECTIONS (perf/performancePolicy.ts) with what bounds it",
  );
  assert.deepEqual(
    listed.filter((owner) => !found.includes(owner)),
    [],
    "MODULE_COLLECTIONS lists a collection that is gone",
  );
  for (const [owner, { bound }] of Object.entries(MODULE_COLLECTIONS))
    assert.ok(bound.length >= 20, `${owner}: say what bounds it`);
});

/** The most pages a `knownPages` keeps: a few dozen of each kind (docs/spec.md › Fluidity). */
const KNOWN_PAGES_MOST = 64;

test("each knownPages keeps at most a few dozen pages, by a number in its module", () => {
  const limits = Object.entries(sources).flatMap(([path, source]) =>
    [...source.matchAll(/= knownPages<.*?>\((\w+)\);/g)].map(([, limit]) => {
      const named = new RegExp(`const ${limit} = (\\d+);`).exec(source)?.[1];
      return [path, Number(/^\d+$/.test(limit!) ? limit : named)] as const;
    }),
  );
  assert.ok(limits.length >= 5, "the guard still finds the knownPages caches");
  for (const [path, limit] of limits) {
    assert.ok(Number.isInteger(limit), `${path}: knownPages takes a number literal or a const`);
    assert.ok(limit <= KNOWN_PAGES_MOST, `${path}: knownPages(${limit}) keeps too many`);
  }
});

test("a planted unbounded cache fails the guard", () => {
  const planted = {
    "planted.ts": [
      "const pages = new Map<string, string>();",
      "const NAMES: ReadonlySet<string> = new Set();",
      "const listeners = new Set<() => void>();",
      "export let seen = new Set<string>();",
      "const kept = knownPages<string>(8);",
    ].join("\n"),
  };
  assert.deepEqual(moduleCollections(planted), [
    "planted.ts#pages",
    "planted.ts#seen",
    "planted.ts#kept",
  ]);
});
