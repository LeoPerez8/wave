import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import { mobileSources } from "./sourceAudit.mjs";

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

// The classic TypeScript compiler API, as sourceAudit.mjs loads it.
const ts = createRequire(createRequire(import.meta.url).resolve("react-doctor"))(
  "typescript",
) as typeof import("typescript");

/** The declaration a node sits in, for `file#name`. */
const ownerOf = (node: import("typescript").Node): string => {
  let owner = "(module)";
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if ((ts.isVariableDeclaration(at) || ts.isFunctionDeclaration(at)) && at.name !== undefined)
      owner = at.name.getText();
  }
  return owner;
};

/** The variable a dependency starts from: `a` for `a`, `a.b`, `a?.b!`. */
const rootOf = (node: import("typescript").Expression): string | null => {
  let at = node;
  while (
    ts.isPropertyAccessExpression(at) ||
    ts.isElementAccessExpression(at) ||
    ts.isNonNullExpression(at) ||
    ts.isParenthesizedExpression(at)
  )
    at = at.expression;
  return ts.isIdentifier(at) ? at.text : null;
};

/** The names [node] reads (not property names after a dot). */
const readsOf = (node: import("typescript").Node): Set<string> => {
  const reads = new Set<string>();
  const visit = (at: import("typescript").Node): void => {
    if (ts.isIdentifier(at) && !(ts.isPropertyAccessExpression(at.parent) && at.parent.name === at))
      reads.add(at.text);
    ts.forEachChild(at, visit);
  };
  visit(node);
  return reads;
};

/** Every memo dependency its function doesn't read, as `file#owner: hook [dep]`. */
const unreadDependencies = (files: Record<string, string>): string[] => {
  const found: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: import("typescript").Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : node.expression.getText();
        const [fn, deps] = node.arguments;
        if (
          (callee === "useMemo" || callee === "useCallback") &&
          fn !== undefined &&
          deps !== undefined &&
          ts.isArrayLiteralExpression(deps)
        ) {
          const reads = readsOf(fn);
          for (const dep of deps.elements) {
            const root = rootOf(dep);
            if (root !== null && !reads.has(root))
              found.push(`${path}#${ownerOf(node)}: ${callee} [${dep.getText()}]`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
};

test("memos read every dependency they list, so the React Compiler keeps them", () => {
  const found = unreadDependencies(mobileSources(join(import.meta.dirname, "..")));
  const unexplained = found.filter((entry) => ALLOWED[entry.split(":")[0]!] === undefined);
  assert.deepEqual(unexplained, [], "read the dependency in the memo, or explain it in ALLOWED");
  const owners = new Set(found.map((entry) => entry.split(":")[0]));
  for (const owner of Object.keys(ALLOWED))
    assert.ok(owners.has(owner), `${owner} reads its dependencies now; remove it from ALLOWED`);
});

test("a dependency listed only to re-make the memo is caught", () => {
  assert.deepEqual(
    unreadDependencies({
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
