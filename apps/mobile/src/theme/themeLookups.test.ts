import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

// Use the same compiler shipped with react-doctor as the existing source guards.
const require = createRequire(import.meta.url);
const ts = createRequire(require.resolve("react-doctor"))("typescript");

/** Each function gets one theme subscription, even when it needs several colours. */
function repeatedLookups(source: string): number[] {
  const file = ts.createSourceFile("component.tsx", source, ts.ScriptTarget.Latest, true);
  const offenders: number[] = [];
  const visit = (node: any): void => {
    if (ts.isFunctionLike(node) && node.body) {
      let reads = 0;
      const count = (child: any): void => {
        if (ts.isFunctionLike(child)) return;
        if (
          ts.isCallExpression(child) &&
          ts.isIdentifier(child.expression) &&
          child.expression.text === "useThemeColor"
        ) reads++;
        ts.forEachChild(child, count);
      };
      count(node.body);
      if (reads > 1) offenders.push(file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return offenders;
}

test("hot rows, artwork, shared buttons and Now Playing batch their theme reads", () => {
  const paths = [
    "catalog/TrackRow.tsx",
    "catalog/Artwork.tsx",
    "components/IconButton.tsx",
    "components/TextButton.tsx",
    ...readdirSync(new URL("../nowPlaying/", import.meta.url))
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => `nowPlaying/${name}`),
  ];
  const offenders = paths.flatMap((path) =>
    repeatedLookups(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"))
      .map((line) => `${path}:${line}`),
  );
  assert.deepEqual(offenders, [], "Use the array form of useThemeColor in these functions");
});
