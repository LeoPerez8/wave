import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./DjScreen.tsx", import.meta.url), "utf8");
const search = readFileSync(new URL("./DjSearch.tsx", import.meta.url), "utf8");

test("DJ puts its search entry point in the bottom bar", () => {
  const topBar = source.match(/className="flex-row justify-between"[\s\S]*?<\/View>/)?.[0];
  const bottomBar = source.slice(source.lastIndexOf('className="bg-background"'));

  assert.ok(topBar);
  assert.ok(bottomBar);
  assert.doesNotMatch(topBar, /IconSearch/);
  assert.match(bottomBar, /IconButton[\s\S]*?icon=\{IconSearch\}/);
  assert.match(
    bottomBar,
    /size=\{CELL \* 6\}[\s\S]*?iconSize=\{CELL \* 3\}[\s\S]*?strokeWidth=\{1\.5\}/,
  );
  assert.match(bottomBar, /label=\{strings\.dj\.search\}/);
  assert.match(bottomBar, /state !== undefined \|\| opening\?\.kind === "nothing"/);
  assert.match(bottomBar, /display: searching \? "none" : "flex"/);
  assert.match(bottomBar, /className="flex-row items-center"/);
  assert.match(search, /autoFocus/);
});
