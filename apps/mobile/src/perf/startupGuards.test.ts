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

test("Now Playing draws without Skia and mounts the lyrics card's host, not its preview", () => {
  const nowPlaying = readdirSync(join(src, "nowPlaying"))
    .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
    .map((name) => [name, imports(read(`nowPlaying/${name}`))] as const);
  for (const heavy of ["@shopify/react-native-skia", "@/share/LyricCardPreview"]) {
    const importers = nowPlaying.filter(([, from]) => from.includes(heavy)).map(([name]) => name);
    assert.deepEqual(importers, [], `nowPlaying/ imports ${heavy}`);
  }
});

test("the Library's layer build leaves its upkeep for after the first screen settles", () => {
  const store = read("library/LibraryStore.ts");
  const make = store.slice(
    store.indexOf("const make = Effect.gen"),
    store.indexOf("return LibraryStore.of("),
  );
  assert.ok(make.length > 0, "LibraryStore's make moved: update this guard");
  const upkeep = make.indexOf("const startupUpkeep = Effect.gen");
  assert.ok(upkeep >= 0, "LibraryStore's startupUpkeep is gone: update this guard");
  const onBuild =
    make.slice(0, make.indexOf("const watchTaste")) + make.slice(make.indexOf("\n  });\n", upkeep));
  for (const step of [
    "relinkCreditsIfUnlinked",
    "keyRecordings",
    "backfillRecordingTitles",
    "watchTasteSources",
  ])
    assert.doesNotMatch(onBuild, new RegExp(`\b${step}\b`), `${step} runs while the layer builds`);
  assert.match(read("app/_layout.tsx"), /afterFirstSettled\("libraryUpkeep", runLibraryUpkeep\)/);
});

test("the downloads' resume and the background fill leave no Library-sized step to one task (#1453)", () => {
  // The resume's finder is built in slices before its first use: built there, it held the
  // thread for the whole Library in `startup downloads`.
  const downloads = read("ytmusic/YtDownloads.ts");
  assert.doesNotMatch(downloads, /\bcurrentLibraryFinder\(/);
  for (const resume of ["forgetSettledFailures", "requeueThrottledFailures"]) {
    const body = downloads.slice(downloads.indexOf(`const ${resume} = `));
    const step = body.slice(0, body.indexOf("\n};\n"));
    assert.match(step, /await freeTurn\(RESUME_WORK\)/, `${resume} starts on a free turn`);
    assert.match(step, /currentLibraryFinderInSlices\(RESUME_WORK\)/, `${resume}'s finder`);
  }
  // The fill indexes what it read in slices, and names them.
  const input = read("library/backgroundFillInput.ts");
  assert.match(input, /runSteps\(\s*indexFillPlaylistsSteps\(/);
  assert.doesNotMatch(input, /\bindexFillPlaylists\(/);
  assert.match(read("library/backgroundFill.ts"), /namedWork\(FILL_WORK\)/);
});

test("Search's screen is built hidden in idle time, so its first tap shows a kept tab (#1438)", () => {
  // A first tap that builds Search held the thread 100–500 ms with a scan running; warmed, it
  // shows a kept tab. The build is a transition, so a touch in the meantime goes first.
  const layout = read("app/_layout.tsx");
  const start = layout.indexOf('afterFirstSettled("searchScreen"');
  assert.ok(start >= 0, "Search's screen isn't warmed after startup");
  const body = layout.slice(start, layout.indexOf("\n", layout.indexOf(");", start)));
  assert.match(body, /startTransition\(\(\) => warmTabScreen\("search"\)\)/);
  // Before the scan, so the build doesn't share the thread with it.
  assert.ok(start < layout.indexOf('afterFirstSettled(\n        "scan"'), "warm Search before the scan");
});
