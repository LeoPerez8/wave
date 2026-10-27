import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

// Load on first use (docs/spec.md, Performance rules): what the first screen
// doesn't need is required when it's first used. Metro's inline requires make
// an import load where its binding is first read, so these guards check that
// the startup path reads no binding of what it should load later.

const app = join(import.meta.dirname, "..", "..");
const src = join(app, "src");
const read = (path: string): string => readFileSync(join(src, path), "utf8");

/** The module specifiers [source] imports at its top level, type-only imports left out. */
const imports = (source: string): string[] =>
  [...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+"([^"]+)";/gms)].map((match) => match[1]!);

test("Metro inlines requires, so an import loads where it's first used", async () => {
  const require = createRequire(import.meta.url);
  const config = require(join(app, "metro.config.js")) as {
    transformer: { getTransformOptions: (...args: unknown[]) => Promise<unknown> };
  };
  const options = (await config.transformer.getTransformOptions([], {}, () => {})) as {
    transform: { inlineRequires: boolean };
  };
  assert.equal(options.transform.inlineRequires, true);
});

test("the root layout mounts the share, cropper and picker hosts, not their screens", () => {
  const root = imports(read("app/_layout.tsx"));
  for (const heavy of [
    "@/share/SongSharePreview",
    "@/library/PhotoCropper",
    "@/library/YtLibraryPicker",
  ]) {
    assert.ok(!root.includes(heavy), `the root layout imports ${heavy}`);
  }
});

test("Now Playing draws without Skia: it stays for the share cards", () => {
  const skia = readdirSync(join(src, "nowPlaying"))
    .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
    .filter((name) => imports(read(`nowPlaying/${name}`)).includes("@shopify/react-native-skia"));
  assert.deepEqual(skia, []);
});
