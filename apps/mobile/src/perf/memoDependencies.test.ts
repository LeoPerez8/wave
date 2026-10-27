import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { mobileSources, unreadMemoDependencies } from "./sourceAudit.mjs";

/**
 * The React Compiler replaces `useMemo` and `useCallback` with its own memos,
 * keyed on what the function reads: a dependency listed only to say "make it
 * again when this changes" is dropped, and compiled, the value goes stale
 * (#728, docs/performance/728-react-compiler.md). So a memo reads every
 * dependency it lists, whether the compiler is on or not. Effects keep their
 * arrays as written and aren't checked.
 *
 * The memos allowed to list a dependency they don't read, and why each may.
 */
const ALLOWED: Record<string, string> = {
  "library/GenreSongList.tsx#useWholeOrder":
    "[key] stands for the genre, sort and order revision the load is built from; the compiler can't preserve this memo and leaves the hook as written",
};

test("memos read every dependency they list, so the React Compiler keeps them", () => {
  const found = unreadMemoDependencies(mobileSources(join(import.meta.dirname, "..")));
  const unexplained = found.filter((entry) => ALLOWED[entry.split(":")[0]!] === undefined);
  assert.deepEqual(unexplained, [], "read the dependency in the memo, or explain it in ALLOWED");
  const owners = new Set(found.map((entry) => entry.split(":")[0]));
  for (const owner of Object.keys(ALLOWED))
    assert.ok(owners.has(owner), `${owner} reads its dependencies now; remove it from ALLOWED`);
});

test("a dependency listed only to re-make the memo is caught", () => {
  assert.deepEqual(
    unreadMemoDependencies({
      "stats/hooks.ts": `
        const useArtistStats = (artistId, songs) =>
          useStatsRead(useCallback((stats) => stats.artist(artistId), [artistId, songs]));
        const useAlways = (visit) => {
          const preference = useValue();
          return useMemo(() => read(preference.value), [preference.value, visit]);
        };
        const useEffectIsFine = (visit) => useEffect(() => read(), [visit]);`,
    }),
    [
      "stats/hooks.ts#useArtistStats: useCallback [songs]",
      "stats/hooks.ts#useAlways: useMemo [visit]",
    ],
  );
});
