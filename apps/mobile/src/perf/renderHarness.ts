/**
 * Desktop tests only; never imported by the app. Loads app modules (`.tsx`
 * included) under node with their native imports replaced, so a test can
 * render real components with `react-test-renderer` and count what they cost:
 * React renders, and the Reanimated shared values and animated styles each
 * instance makes (#1423).
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";

import { stubModule } from "./reactCompilerBuilds.ts";

export { stubModule };

const expoRequire = createRequire(createRequire(import.meta.url).resolve("expo/package.json"));
const presetRequire = createRequire(expoRequire.resolve("babel-preset-expo"));
const babel = presetRequire("@babel/core") as {
  readonly transformSync: (code: string, options: Record<string, unknown>) => { code: string };
};

const react = JSON.stringify(import.meta.resolve("react"));

/** What the counting Reanimated stub has made since the last `resetAnimationCounts`. */
export interface AnimationCounts {
  sharedValues: number;
  animatedStyles: number;
}

const COUNTS_KEY = "__waveAnimationCounts";

/** The counts the stub keeps on `globalThis`. */
export const animationCounts = (): AnimationCounts => {
  const scope = globalThis as unknown as Record<string, AnimationCounts | undefined>;
  return (scope[COUNTS_KEY] ??= { sharedValues: 0, animatedStyles: 0 });
};

export const resetAnimationCounts = (): void => {
  const counts = animationCounts();
  counts.sharedValues = 0;
  counts.animatedStyles = 0;
};

/**
 * Reanimated as the tests see it: a shared value is a plain box and an
 * animated style is computed once, each counted as it is made (what costs a
 * UI-thread registration on a phone).
 */
export const countingReanimated = stubModule(`
  import { useState, createElement } from ${react};
  const counts = (globalThis.${COUNTS_KEY} ??= { sharedValues: 0, animatedStyles: 0 });
  export const createAnimatedComponent = component => component;
  export const Easing = { out: value => value, exp: value => value };
  export const useReducedMotion = () => false;
  export const makeMutable = initial => {
    counts.sharedValues++;
    let value = initial;
    return { get: () => value, set: next => { value = next; }, get value() { return value; }, set value(next) { value = next; } };
  };
  export const useSharedValue = initial => useState(() => makeMutable(initial))[0];
  // Read live, as a phone's UI thread would apply it: each property reads the values now.
  // One handle per hook for its whole life, as Reanimated keeps it; it reads the latest updater.
  export const useAnimatedStyle = read => {
    const [box] = useState(() => {
      counts.animatedStyles++;
      const box = { read };
      box.style = new Proxy({}, { get: (_, key) => box.read()[key], ownKeys: () => Reflect.ownKeys(box.read()), getOwnPropertyDescriptor: (_, key) => ({ value: box.read()[key], enumerable: true, configurable: true }) });
      return box;
    });
    box.read = read;
    return box.style;
  };
  export const withTiming = value => value;
  export const withSpring = value => value;
  export const withSequence = (...values) => values.at(-1);
  const View = props => createElement("view", props);
  export default { View, createAnimatedComponent };
`);

/** The native modules every primitive reaches, as plain host components and no-ops. */
export const nativeStubs = (): Record<string, string> => ({
  "react-native": stubModule(`
    export const Text = "text", View = "view", Pressable = "pressable";
    export const StyleSheet = { hairlineWidth: 1, absoluteFill: {}, create: styles => styles };
    export const AppState = { currentState: "active", addEventListener: () => ({ remove() {} }) };
    export const PixelRatio = { getPixelSizeForLayoutSize: size => size * 3 };
    export const Image = "softwareImage";
  `),
  "react-native-reanimated": countingReanimated,
  "@/native/waveAppLog": stubModule(`export const WaveAppLog = {};`),
  "@/log/appLog": stubModule(`export const appLog = () => {};`),
  "expo-haptics": stubModule(`
    export const selectionAsync = async () => {};
    export const impactAsync = async () => {};
    export const ImpactFeedbackStyle = { Light: "light" };
  `),
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
  "@tabler/icons-react-native": stubModule(`
    export const IconCircle = "IconCircle", IconCircleCheckFilled = "IconCircleCheckFilled";
    export const IconMusic = "IconMusic";
  `),
});

/**
 * Imports [urls] with [stubs] replacing imports by specifier; `@/` resolves
 * to `src/` and `.tsx` modules are transformed with Babel. Hooks are removed
 * once the modules are loaded.
 */
export const loadWithStubs = async <M extends readonly unknown[]>(
  urls: { readonly [K in keyof M]: string },
  stubs: Readonly<Record<string, string>>,
): Promise<M> => {
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
              [
                presetRequire.resolve("@babel/plugin-transform-react-jsx"),
                { runtime: "automatic" },
              ],
            ],
          }).code,
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });
  try {
    return (await Promise.all(urls.map((url) => import(url)))) as unknown as M;
  } finally {
    hooks.deregister();
  }
};
