/**
 * Desktop tests only; never imported by the app. Loads a module twice, as
 * written and as the React Compiler builds it for a release
 * (`EXPO_PUBLIC_WAVE_REACT_COMPILER=1`, docs/performance/728-react-compiler.md), so a test
 * can check both behave the same. Only that module is compiled; what it
 * imports loads as written.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

/** A module from [source], for a stub. */
export const stubModule = (source: string): string =>
  `data:text/javascript,${encodeURIComponent(source)}`;

interface Babel {
  readonly transformSync: (
    code: string,
    options: Record<string, unknown>,
  ) => { readonly code?: string | null } | null;
}

// Babel and the compiler babel-preset-expo runs; neither is a direct dependency.
const expoRequire = createRequire(createRequire(import.meta.url).resolve("expo/package.json"));
const presetRequire = createRequire(expoRequire.resolve("babel-preset-expo"));

const compile = (path: string): string => {
  const babel = presetRequire("@babel/core") as Babel;
  const output = babel.transformSync(readFileSync(path, "utf8"), {
    filename: path,
    babelrc: false,
    configFile: false,
    plugins: [
      [presetRequire.resolve("@babel/plugin-syntax-typescript"), { isTSX: path.endsWith(".tsx") }],
      [
        presetRequire.resolve("babel-plugin-react-compiler"),
        // babel-preset-expo's release options, except that a function the compiler
        // can't build fails the test instead of staying as written.
        { target: "19", panicThreshold: "all_errors" },
      ],
    ],
  });
  const code = output?.code ?? "";
  assert.ok(code.includes("react/compiler-runtime"), `the compiler built ${path}`);
  return code;
};

/**
 * [url] as written and compiled. [stubs] replace imports by specifier (an
 * exact `@/…` or relative one, or a package); `@/` imports resolve to `src/`.
 */
export const reactCompilerBuilds = async <M>(
  url: string,
  stubs: Readonly<Record<string, string>> = {},
): Promise<Readonly<Record<"as written" | "compiled", M>>> => {
  const src = new URL("../", import.meta.url);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const stub = stubs[specifier];
      if (stub !== undefined) return { url: stub, shortCircuit: true };
      if (specifier.startsWith("@/")) specifier = new URL(`${specifier.slice(2)}.ts`, src).href;
      if (specifier.startsWith(".") && existsSync(new URL(`${specifier}.ts`, context.parentURL)))
        specifier += ".ts";
      return nextResolve(specifier, context);
    },
    load(loaded, context, nextLoad) {
      if (loaded !== `${url}?compiled`) return nextLoad(loaded, context);
      return {
        format: "module-typescript",
        source: compile(fileURLToPath(url)),
        shortCircuit: true,
      };
    },
  });
  try {
    return {
      "as written": (await import(url)) as M,
      compiled: (await import(`${url}?compiled`)) as M,
    };
  } finally {
    hooks.deregister();
  }
};
