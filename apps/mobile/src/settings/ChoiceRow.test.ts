import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { stubModule } from "../perf/reactCompilerBuilds.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Keep the real choice rows, buttons, presses and setting; replace native APIs.
const react = JSON.stringify(import.meta.resolve("react"));
const native = stubModule(`
  export const Text = "span", View = "div", Pressable = "button";
  export const StyleSheet = { hairlineWidth: 1 };
  export const AppState = { addEventListener: () => ({ remove() {} }) };
`);
const stubs: Record<string, string> = {
  "react-native": native,
  "@/native/waveAppLog": stubModule(`export const WaveAppLog = {};`),
  "@tabler/icons-react-native": stubModule('export const IconCheck = "IconCheck";'),
  "expo-haptics": stubModule("export const selectionAsync = async () => {};"),
  "expo-sqlite/kv-store": stubModule(`
    const values = new Map();
    export const Storage = {
      getItemSync: key => values.get(key) ?? null,
      setItemSync: (key, value) => values.set(key, value),
      removeItemSync: key => values.delete(key),
    };
  `),
  uniwind: stubModule(`
    export const withUniwind = component => component;
    export const useCSSVariable = names => names.map(() => "#ffffff");
  `),
  "react-native-reanimated": stubModule(`
    import { useState } from ${react};
    export const createAnimatedComponent = component => component;
    export const Easing = { out: value => value, exp: value => value };
    export const useReducedMotion = () => true;
    export const useAnimatedStyle = read => read();
    export const withTiming = value => value;
    export const useSharedValue = initial => useState(() => {
      let value = initial;
      return { get: () => value, set: next => { value = next; } };
    })[0];
  `),
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
let ChoiceSection: (typeof import("./ChoiceRow.tsx"))["ChoiceSection"];
let persistedSetting: (typeof import("../lib/persistedSetting.ts"))["persistedSetting"];
try {
  ({ ChoiceSection } = await import("./ChoiceRow.tsx"));
  ({ persistedSetting } = await import("../lib/persistedSetting.ts"));
} finally {
  hooks.deregister();
}

test("Settings choices always explain themselves visually and as hints, and still save a selection", async () => {
  const setting = persistedSetting({
    key: "test.choices",
    read: (value) => value ?? "real",
    write: (value) => value,
  });
  const choices = [
    { value: "real", label: "Real Shuffle", line: "Any order, every one as likely" },
    { value: "smart", label: "Smart Shuffle", line: "Your most played, spread among the rest" },
    { value: "even", label: "Even Shuffle", line: "Artists take turns, never twice in a row" },
  ];
  function Screen() {
    return createElement(ChoiceSection<string>, {
      choice: { label: "Shuffle", choices, setting },
      current: setting.useValue(),
      note: "Every shuffle uses it.",
    });
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(createElement(Screen));
    });
    const rows = () =>
      renderer!.root.findAll((node) => typeof node.type === "string" && node.type === "button");
    assert.deepEqual(
      rows().map((row) => row.props.accessibilityHint),
      choices.map((choice) => choice.line),
    );
    assert.deepEqual(
      rows().map((row) => row.props.accessibilityState.checked),
      [true, false, false],
    );
    for (const { line } of choices) {
      const text = renderer!.root
        .findAll((node) => typeof node.type === "string" && node.type === "span")
        .find((node) => node.props.children === line);
      assert.ok(text, `the description is visible: ${line}`);
      assert.equal(text.props.numberOfLines, undefined, "descriptions wrap without a line limit");
    }
    assert.equal(
      renderer!.root.findAll((node) => typeof node.type === "string" && node.type === "span").at(-1)
        ?.props.children,
      "Every shuffle uses it.",
    );
    await act(() => rows()[2]!.props.onPress());
    assert.equal(setting.get(), "even");
    assert.deepEqual(
      rows().map((row) => row.props.accessibilityState.checked),
      [false, false, true],
    );
  } finally {
    await act(() => renderer?.unmount());
  }
});

test("choices without descriptions keep their label and selection behavior", async () => {
  const setting = persistedSetting({
    key: "test.plainChoice",
    read: () => "list",
    write: (value) => value,
  });
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(
        createElement(ChoiceSection<string>, {
          choice: { label: "View", choices: [{ value: "list", label: "List" }], setting },
          current: "list",
        }),
      );
    });
    const row = renderer!.root.find(
      (node) => typeof node.type === "string" && node.type === "button",
    );
    assert.equal(row.props.accessibilityLabel, "List");
    assert.equal(row.props.accessibilityHint, undefined);
    assert.equal(row.props.accessibilityState.checked, true);
    assert.deepEqual(
      row
        .findAll((node) => typeof node.type === "string" && node.type === "span")
        .map((node) => node.props.children),
      ["List"],
    );
  } finally {
    await act(() => renderer?.unmount());
  }
});
