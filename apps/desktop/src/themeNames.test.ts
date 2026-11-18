import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const names = (css: string) => new Set(css.match(/--color-[a-z0-9-]+(?=:)/g));
const block = (css: string, opening: string) => {
  const start = css.indexOf(opening);
  assert.notEqual(start, -1, opening);
  return css.slice(start, css.indexOf("}", start));
};

test("Tailwind knows every colour the shared stylesheet sets per scheme", () => {
  const shared = read("../../../packages/theme/colours.css");
  const perScheme = names(block(shared, "@variant light"));
  assert.deepEqual(perScheme, names(block(shared, "@variant dark")));
  const registered = names(block(read("./renderer/src/styles.css"), "@theme reference"));
  assert.deepEqual([...registered].toSorted(), [...perScheme].toSorted());
});
