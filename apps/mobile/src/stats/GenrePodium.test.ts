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
  export const View = "View", Text = "Text", CELL = 8;
  export const useWindowDimensions = () => ({ fontScale: 1 });
  export const useThemeColor = () => ["#ffaa00", "#ffffff"];
  export const useLocalisation = () => ({ strings: { stats: {
    genrePercent: (share) => share * 100 + "%",
    genreBarLabel: (_rank, name, percent) => name + " " + percent,
  } } });
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "react-native" || specifier.startsWith("@/"))
      return { url: boundary, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith("/GenrePodium.tsx"))
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
const { GenrePodium } = await import("./GenrePodium.tsx");
hooks.deregister();

const layout = { nativeEvent: { layout: { width: 358, height: 0 } } };
const family = (name: string, share: number): RecapGenre => ({
  family: { key: name.toLowerCase(), name },
  share,
});

test("the podium draws #1 in front and reads its families in rank order", () => {
  const genres = [family("Rock", 0.5), family("Pop", 0.3), family("Jazz", 0.2)];
  let renderer: ReturnType<typeof create> | undefined;
  try {
    act(() => {
      renderer = create(createElement(GenrePodium, { genres }));
    });
    const podium = renderer!.root.findByProps({ accessible: true });
    assert.equal(podium.props.accessibilityLabel, "Rock 50%; Pop 30%; Jazz 20%");
    const bars = () => renderer!.root.findAll((node) => node.props.style?.position === "absolute");
    assert.equal(bars().length, 0);
    act(() => podium.props.onLayout(layout));
    // On screen Pop, Rock, Jazz; drawn back to front, so Rock (in the accent) comes last.
    assert.deepEqual(
      bars().map((bar) => bar.props.style.left),
      [216, 58, 124],
    );
    assert.equal(bars().at(-1)!.props.style.backgroundColor, "#ffaa00");
    const names = renderer!.root
      .findAll((node) => (node.type as unknown) === "Text")
      .map((node) => node.props.children)
      .filter((child) => genres.some((genre) => genre.family.name === child));
    assert.deepEqual(names, ["Pop", "Rock", "Jazz"]);
  } finally {
    act(() => renderer?.unmount());
  }
});
