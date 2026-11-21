/**
 * #1354's guard: Search's index is kept in memory for the session, so
 * opening Search and typing read nothing from the Library. The screens ask
 * the kept index (`useSearchIndex`), which follows the Library on its own;
 * neither it nor the screens follow a whole-Library query of their own.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

/** What makes a screen read the Library's lists itself. */
const WHOLE_LIBRARY = /\buseLibraryQuery\s*\(|\buseLoadedLibraryFinder\s*\(|\blibraryListQueries\b/;

test("Search and DJ's search follow no whole-Library query of their own", () => {
  for (const path of ["app/(tabs)/search.tsx", "dj/DjSearch.tsx"])
    assert.doesNotMatch(read(path), WHOLE_LIBRARY, path);
});

test("the kept index's hook reads nothing: only the follower does, from startup", () => {
  const source = read("search/searchIndex.ts");
  const hook = source.slice(source.indexOf("export const useSearchIndex"));
  assert.ok(hook.length > 0);
  assert.doesNotMatch(hook, WHOLE_LIBRARY);
  assert.doesNotMatch(hook, /\bappRuntime\b|\bLibraryStore\b|\breadSource\s*\(|\bpatchSongs\s*\(/);
  assert.match(read("app/_layout.tsx"), /afterFirstSettled\("searchIndex"/);
});
