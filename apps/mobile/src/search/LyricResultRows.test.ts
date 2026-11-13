import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { stubModule } from "../perf/reactCompilerBuilds.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// The real rows; native views, artwork and what a press starts are stubbed, and each press's
// effect is recorded.
const calls = stubModule("export const calls = [];");
const record = (name: string) =>
  `import { calls } from ${JSON.stringify(calls)};
   export const ${name} = (...args) => void calls.push([${JSON.stringify(name)}, ...args]);`;
const stubs: Record<string, string> = {
  "react-native": stubModule(`
    export const Text = "span", View = "div", Pressable = "button";
    export const ActivityIndicator = "spinner";
  `),
  "@/catalog/Artwork": stubModule('export const Artwork = "img";'),
  "@/catalog/artworkUri": stubModule("export const artworkUri = () => undefined;"),
  "@/catalog/grid": stubModule("export const CELL = 8; export const grid = { row: 64 };"),
  "@/localisation/localisation": stubModule(`
    export const useLocalisation = () => ({
      strings: { playbackText: { geniusLyricsResult: (title, artist) => title + ", " + artist } },
    });
  `),
  "@/theme/useThemeColor": stubModule('export const useThemeColor = () => "#ffffff";'),
  "@/songs/mixedSongs": stubModule(record("openMixedSongActions")),
  "./playSearchSong": stubModule(record("playSearchSong")),
  "./GeniusHitActions": stubModule(record("openGeniusHitActions")),
};
const expoRequire = createRequire(createRequire(import.meta.url).resolve("expo/package.json"));
const presetRequire = createRequire(expoRequire.resolve("babel-preset-expo"));
const babel = presetRequire("@babel/core");
const src = new URL("../", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = stubs[specifier];
    if (stub !== undefined) return { url: stub, shortCircuit: true };
    if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), src).href;
    if (specifier.startsWith(".") || specifier.startsWith("file:")) {
      const url = new URL(specifier, context.parentURL);
      if (url.href.startsWith(src.href) && !/\.tsx?$/.test(url.pathname)) {
        for (const ext of [".ts", ".tsx"]) {
          if (existsSync(new URL(`${url.href}${ext}`)))
            return nextResolve(`${url.href}${ext}`, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(src.href) && url.endsWith(".tsx")) {
      return {
        format: "module",
        source: babel.transformSync(readFileSync(new URL(url), "utf8"), {
          filename: new URL(url).pathname,
          babelrc: false,
          configFile: false,
          plugins: [
            [presetRequire.resolve("@babel/plugin-transform-typescript"), { isTSX: true }],
            [presetRequire.resolve("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
          ],
        }).code,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
let rows: typeof import("./LyricResultRows.tsx");
let pressed: unknown[][];
try {
  rows = await import("./LyricResultRows.tsx");
  ({ calls: pressed } = (await import(calls)) as { calls: unknown[][] });
} finally {
  hooks.deregister();
}

const lyric = {
  source: "library" as const,
  song: { id: 5, title: "Teardrop", artist: "Massive Attack" },
  line: "Love, love is a verb",
  ranges: [{ start: 0, end: 4 }],
} as unknown as Parameters<typeof rows.LyricResultRow>[0]["hit"];
const genius = {
  id: 8,
  title: "Teardrop",
  artist: "Massive Attack",
  credit: "Massive Attack",
  url: "https://genius.com/Massive-attack-teardrop-lyrics",
  artworkUrl: null,
};

/** Renders [element] and returns its row's press target. */
const rowOf = async (element: ReturnType<typeof createElement>) => {
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(element);
  });
  const [row] = renderer!.root.findAll(
    (node) => typeof node.type === "string" && node.type === "button",
  );
  assert.ok(row);
  return { row, renderer: renderer! };
};

test("while selecting, a lyric row and a Genius row take no tap or long press", async () => {
  pressed.length = 0;
  const opened: unknown[] = [];
  const onOpen = () => void opened.push("open");
  const onGeniusHit = (hit: unknown) => void opened.push(hit);
  for (const element of [
    createElement(rows.LyricResultRow, { hit: lyric, selecting: true, onOpen }),
    createElement(rows.GeniusLyricResultRow, {
      hit: genius,
      selecting: true,
      pending: false,
      onOpen,
      onGeniusHit,
    }),
  ]) {
    const { row, renderer } = await rowOf(element);
    await act(() => {
      row.props.onPress?.();
      row.props.onLongPress?.();
    });
    await act(() => renderer.unmount());
  }
  assert.deepEqual(pressed, []);
  assert.deepEqual(opened, []);
});

test("out of selection, a lyric row plays its song and a Genius row opens its hit", async () => {
  pressed.length = 0;
  const opened: unknown[] = [];
  const onOpen = () => void opened.push("open");
  const onGeniusHit = (hit: unknown) => void opened.push(hit);
  const lyricRow = await rowOf(
    createElement(rows.LyricResultRow, { hit: lyric, selecting: false, onOpen }),
  );
  await act(() => {
    lyricRow.row.props.onPress();
    lyricRow.row.props.onLongPress();
  });
  await act(() => lyricRow.renderer.unmount());
  const geniusRow = await rowOf(
    createElement(rows.GeniusLyricResultRow, {
      hit: genius,
      selecting: false,
      pending: false,
      onOpen,
      onGeniusHit,
    }),
  );
  await act(() => {
    geniusRow.row.props.onPress();
    geniusRow.row.props.onLongPress();
  });
  await act(() => geniusRow.renderer.unmount());
  const song = { source: "library", track: lyric.song };
  assert.deepEqual(pressed, [
    ["playSearchSong", song],
    ["openMixedSongActions", song],
    ["openGeniusHitActions", genius],
  ]);
  assert.deepEqual(opened, ["open", "open", genius]);
});

test("a Genius row being looked up shows it is busy until it resolves", async () => {
  const props = {
    hit: genius,
    selecting: false,
    onOpen: () => undefined,
    onGeniusHit: () => undefined,
  };
  const busy = await rowOf(createElement(rows.GeniusLyricResultRow, { ...props, pending: true }));
  assert.equal(busy.row.props.accessibilityState?.busy, true);
  assert.equal(busy.renderer.root.findAllByType("spinner" as never).length, 1);
  await act(() => busy.renderer.unmount());

  const idle = await rowOf(createElement(rows.GeniusLyricResultRow, { ...props, pending: false }));
  assert.notEqual(idle.row.props.accessibilityState?.busy, true);
  assert.equal(idle.renderer.root.findAllByType("spinner" as never).length, 0);
  await act(() => idle.renderer.unmount());
});
