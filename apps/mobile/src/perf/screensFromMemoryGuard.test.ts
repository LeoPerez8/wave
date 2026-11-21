/**
 * #1352's desktop guard: a local screen's first render reads only memory.
 * Every route is a covered screen (`SCREENS_FROM_MEMORY`), a tab's alias of
 * one, or listed as not local with its reason; each hook a covered screen's
 * first frame draws says how its data is in memory before the screen opens
 * (`MEMORY_SOURCES`), and the source holds that; and no covered route reads
 * the Library from its own body.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import {
  MEMORY_SOURCES,
  NOT_LOCAL_SCREENS,
  SCREEN_PRESS_READS,
  SCREENS_FROM_MEMORY,
} from "./screensFromMemory.ts";
import { mobileSources } from "./sourceAudit.mjs";

const sources: Record<string, string> = mobileSources(join(import.meta.dirname, ".."));

/** Layouts, which draw no screen of their own. */
const isLayout = (path: string): boolean => /(^|\/)_layout\.tsx$/.test(path);

/** A tab's route that re-exports a covered screen (`export { default } from "@/app/..."`). */
const aliasOf = (text: string): string | null => {
  const match = /export \{ default \} from "@\/(app\/[^"]+)";/.exec(text);
  return match === null ? null : `${match[1]}.tsx`;
};

const routes = Object.keys(sources).filter((path) => path.startsWith("app/") && !isLayout(path));

const textOf = (path: string): string => {
  const text = sources[path];
  assert.ok(text !== undefined, `${path} is gone: update perf/screensFromMemory.ts`);
  return text;
};

const [fileOf, symbolOf] = [
  (source: string) => source.split("#")[0]!,
  (source: string) => source.split("#")[1]!,
];

test("every route is a screen drawn from memory, a tab's alias of one, or not local", () => {
  const unlisted = routes.filter((path) => {
    if (SCREENS_FROM_MEMORY[path] !== undefined || NOT_LOCAL_SCREENS[path] !== undefined)
      return false;
    const alias = aliasOf(textOf(path));
    return alias === null || SCREENS_FROM_MEMORY[alias] === undefined;
  });
  assert.deepEqual(unlisted, [], "say what each new screen's first frame draws from memory");
  for (const path of [...Object.keys(SCREENS_FROM_MEMORY), ...Object.keys(NOT_LOCAL_SCREENS)])
    assert.ok(routes.includes(path), `${path} is gone: drop its entry`);
  for (const [path, reason] of Object.entries(NOT_LOCAL_SCREENS))
    assert.ok(reason.trim().length > 30, `${path} needs a reviewable reason`);
});

test("each screen calls the hooks its entry says its first frame draws", () => {
  for (const [path, screen] of Object.entries(SCREENS_FROM_MEMORY)) {
    const texts = [path, ...(screen.via ?? [])].map(textOf).join("\n");
    for (const draw of screen.draws) {
      assert.ok(MEMORY_SOURCES[draw] !== undefined, `${draw} (${path}) says nothing of memory`);
      assert.ok(
        new RegExp(`\\b${symbolOf(draw)}\\(`).test(texts),
        `${path} no longer draws ${draw}: update its entry`,
      );
    }
  }
});

test("each hook a screen draws keeps its data in memory as its entry says", () => {
  const ready = textOf("library/readyScreens.ts");
  const hooks = textOf("library/hooks.ts");
  const keptAtStartup = hooks.slice(hooks.indexOf("export const readyLibraryQueries"));
  const memory = textOf("library/libraryMemory.ts");
  for (const [source, how] of Object.entries(MEMORY_SOURCES)) {
    const text = textOf(fileOf(source));
    assert.ok(
      new RegExp(`(export const|const|function) ${symbolOf(source)}\\b`).test(text),
      `${source} isn't defined there`,
    );
    switch (how.kind) {
      case "kept":
        assert.ok(
          new RegExp(`\\b${how.name}\\b`).test(keptAtStartup) ||
            new RegExp(`\\b${how.name}\\b`).test(ready),
          `${source}: ${how.name} isn't kept at startup (readyScreens.ts, readyLibraryQueries)`,
        );
        break;
      case "rows":
        assert.ok(
          memory.includes(`export const ${how.name}`),
          `${how.name} isn't libraryMemory.ts's`,
        );
        assert.ok(text.includes(how.name), `${source} doesn't draw from ${how.name}`);
        break;
      case "session":
        assert.ok(
          new RegExp(`(let|const) ${how.name}\\b`).test(text) || text.includes(how.name),
          `${source}: ${how.name} isn't kept there`,
        );
        break;
      case "recent":
        assert.ok(text.includes("keepRecentlyOpened"), `${source} isn't kept once opened`);
        assert.ok(text.includes(how.name), `${source}: ${how.name} isn't its query`);
        assert.ok(how.reason.trim().length > 30, `${source} needs a reason to wait for its open`);
        break;
      case "snapshot":
        assert.ok(text.includes("useSnapshotted("), `${source} doesn't draw Home's snapshot`);
        assert.ok(
          new RegExp(`\\b${how.name}\\b`).test(keptAtStartup) ||
            new RegExp(`\\b${how.name}\\b`).test(ready) ||
            new RegExp(`\\b${how.name}\\b`).test(textOf("home/homeReady.ts")) ||
            new RegExp(`let ${how.name}\\b`).test(text),
          `${source}: ${how.name} isn't kept at startup (readyScreens.ts, homeReady.ts) or for the session`,
        );
        break;
      case "store":
        assert.ok(
          /useSyncExternalStore|useSightedStore|useValue\(/.test(text),
          `${source} isn't a store`,
        );
        break;
    }
  }
});

test("a covered route reads the Library only from a reviewed press", () => {
  const reading = Object.keys(SCREENS_FROM_MEMORY).filter((path) =>
    /\.runPromise\(|LibraryStore\.use\(/.test(textOf(path)),
  );
  assert.deepEqual(
    reading.filter((path) => SCREEN_PRESS_READS[path] === undefined),
    [],
    "draw the screen from memory (readyScreens.ts) instead of reading in it",
  );
  for (const [path, reason] of Object.entries(SCREEN_PRESS_READS)) {
    assert.ok(reading.includes(path), `${path} no longer reads: drop its entry`);
    assert.ok(reason.trim().length > 30, `${path} needs a reviewable reason`);
  }
});

test("Home's first frame draws memory or its snapshot, never a local section's skeleton", () => {
  const home = Object.keys(sources).filter(
    (path) => path === "app/(tabs)/index.tsx" || path.startsWith("home/"),
  );
  assert.ok(!home.includes("home/HomeSectionSkeleton.tsx"), "Home's local skeletons are gone");
  assert.deepEqual(
    home.filter((path) => /HomeSectionSkeleton|HomePlaceholders/.test(textOf(path))),
    [],
  );
  // The cold-start snapshot is read before Home's first render and saved when the app leaves.
  const snapshot = textOf("home/homeSnapshot.ts");
  assert.match(snapshot, /parseHomeSnapshot\(/);
  assert.match(snapshot, /storedHomeSnapshot(<\w+>)?\(/);
  assert.match(snapshot, /AppState/);
  assert.match(textOf("library/readyScreens.ts"), /keepHomeReady\(/);
});

test("Search's index and the screens' data start whatever All files access says", () => {
  // They read the database, not the music files: a phone without the grant still opens from memory.
  const effects = textOf("app/_layout.tsx").split(/\buseEffect\(/);
  for (const job of ["searchIndex", "readyScreens"]) {
    const effect = effects.find((text) => text.includes(`afterFirstSettled("${job}"`));
    assert.ok(effect !== undefined, `${job} no longer starts in the root layout`);
    const body = effect.slice(0, effect.search(/\n {2}\}, \[[^\]]*\]\);/));
    assert.doesNotMatch(body, /\bgranted\b/, `${job} waits on All files access`);
  }
});

test("Stats opens from the queries kept at startup, with no skeleton", () => {
  const hooks = textOf("stats/hooks.ts");
  for (const hook of ["useRanking", "useTopGenres"]) {
    const at = hooks.indexOf(`const ${hook} =`);
    assert.ok(at >= 0, `${hook} is gone: update this guard`);
    const body = hooks.slice(at, hooks.indexOf("\nexport ", at + 1));
    assert.match(body, /\buseLibraryQuery\b/, `${hook} doesn't draw its kept query`);
  }
  for (const route of ["app/library/stats/index.tsx", "app/library/stats/[ranking].tsx"])
    assert.doesNotMatch(textOf(route), /Skeleton/, `${route} draws a skeleton`);
  assert.match(
    textOf("library/readyScreens.ts"),
    /keepReady\("Stats page", statsOpeningQueries\(\)\)/,
  );
});
