/// <reference types="node" />
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";

/**
 * expo-router's route hooks read one context that changes on every navigation,
 * so every component calling them renders again on every push, pop and tab
 * switch, wherever it is (#303, docs/performance/303-contained-nav-renders.md).
 * Always-mounted components (the root layout, the hidden Now Playing, warmed
 * list screens) follow the route through `useCurrentPath` instead, which reads
 * an external store and can stop listening while hidden.
 *
 * The modules allowed to call them, and why each may.
 */
const ALLOWED: Record<string, string> = {
  "app/(tabs)/_layout.tsx":
    "TabsLayout needs the tab in the commit that shows it (entry motion); its chrome is memoized",
  "chrome/chrome.tsx": "useFloatingChromeHeight: overlay cards and toasts, mounted while shown",
  "library/routes.ts": "FollowCurrentRoute: a leaf that renders nothing and republishes the route",
  "perf/PerfProbe.tsx": "perf builds only, a leaf",
  "playback/itemActions.ts": "menus and the selection bar, mounted while shown",
  "ytmusic/YtSongActions.tsx": "a song's menu, mounted while shown",
};

const ROUTE_HOOK = /\b(usePathname|useGlobalSearchParams|useSegments|useRouteInfo)\s*\(/;

const src = join(import.meta.dirname, "..");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });

test("only leaves and short-lived components follow the route through expo-router's hooks", () => {
  const observers = sources(src)
    .filter((path) => ROUTE_HOOK.test(readFileSync(path, "utf8")))
    .map((path) => relative(src, path).split(sep).join("/"))
    .toSorted();
  assert.deepEqual(observers, Object.keys(ALLOWED).toSorted());
});
