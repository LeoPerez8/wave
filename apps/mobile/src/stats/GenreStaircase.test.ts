import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
// Use the same TSX transform shipped by Expo, without changing app dependencies.
const expoRequire = createRequire(import.meta.resolve("expo"));
const babel = expoRequire("@babel/core");
import type { RecapGenre } from "@wave/core";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const boundary = `data:text/javascript,${encodeURIComponent(`
  export const View = "View", Text = "Text", CELL = 4;
  export const useWindowDimensions = () => ({ fontScale: 1 });
  export const useThemeColor = () => ["#ffaa00", "#ffffff"];
  export const useLocalisation = () => ({ strings: { stats: {
    genrePercent: (share) => share * 100 + "%",
    genreBlockLabel: (_rank, name, percent) => name + " " + percent,
  } } });
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "react-native" || specifier.startsWith("@/"))
      return { url: boundary, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith("/GenreStaircase.tsx"))
      return {
        format: "module",
        shortCircuit: true,
        source: babel.transformSync(readFileSync(new URL(url), "utf8"), {
          filename: new URL(url).pathname,
          configFile: false,
          babelrc: false,
          presets: [
            [
              expoRequire.resolve("babel-preset-expo"),
              { disableImportExportTransform: true, enableBabelRuntime: false },
            ],
          ],
        }).code,
      };
    return next(url, context);
  },
});
const { GenreStaircase } = await import("./GenreStaircase.tsx");
hooks.deregister();

const layout = (height: number) => ({ nativeEvent: { layout: { width: 360, height } } });

test("blocks first appear with measured labels and shrink when the period's labels change", () => {
  const genres: RecapGenre[] = [{ family: { key: "rock", name: "Rock" }, share: 1 }];
  let renderer: ReturnType<typeof create> | undefined;
  try {
    act(() => {
      renderer = create(createElement(GenreStaircase, { genres }));
    });
    act(() =>
      renderer!.root
        .findAll((node) => (node.type as unknown) === "View")[0]!
        .props.onLayout(layout(0)),
    );
    assert.equal(renderer!.root.findAllByProps({ accessible: true }).length, 0);
    const measure = () => renderer!.root.findAllByProps({ pointerEvents: "none" })[0]!;
    act(() => measure().props.onLayout(layout(120)));
    const block = () => renderer!.root.findAllByProps({ accessible: true })[0]!;
    assert.equal(block().props.style.minHeight, 248);
    assert.equal(block().props.style.backgroundColor, "#ffaa00");
    const next = [{ ...genres[0]!, share: 0.5 }];
    act(() => renderer!.update(createElement(GenreStaircase, { genres: next })));
    assert.equal(renderer!.root.findAllByProps({ accessible: true }).length, 0);
    act(() => measure().props.onLayout(layout(42)));
    assert.equal(block().props.style.minHeight, 122);
  } finally {
    act(() => renderer?.unmount());
  }
});
