import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { beforeEach, test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { stubModule } from "../perf/reactCompilerBuilds.ts";

/**
 * From YT Music's picker with its frame stubbed: the library reads as Liked
 * Songs alone (always listed, ticked), and the test decides how
 * `importYtLibrary` settles; `showError` writes to `globalThis.pickerTest`.
 */
interface PickerTest {
  readonly errors: string[];
  importing: () => Promise<void>;
}
const shared: PickerTest = { errors: [], importing: async () => {} };
Object.assign(globalThis, { pickerTest: shared, IS_REACT_ACT_ENVIRONMENT: true });

const core = JSON.stringify(import.meta.resolve("@wave/core"));
const result = JSON.stringify(import.meta.resolve("effect/Result"));
const stubs: Record<string, string> = {
  "react-native": stubModule(`
    export const ActivityIndicator = "spinner", FlatList = "list", Switch = "switch",
      Text = "text", View = "view";
  `),
  "@/catalog/Artwork": stubModule('export const Artwork = "artwork";'),
  "@/catalog/CheckCell": stubModule('export const CheckCell = "check";'),
  "@/components/TextButton": stubModule('export const TextButton = "button";'),
  "@/localisation/localisation": stubModule(`
    import { catalogueOf } from ${core};
    export const currentLocalisation = () => ({ language: "en", strings: catalogueOf("en") });
    export const useLocalisation = currentLocalisation;
  `),
  "@/motion/Press": stubModule('export const Press = "press";'),
  "@/overlay/alert": stubModule(`
    export const showError = (title) => { globalThis.pickerTest.errors.push(title); };
  `),
  "@/settings/spotifyAccount": stubModule("export const signInToSpotify = async () => false;"),
  "@/settings/ytAccount": stubModule("export const signInToYtMusic = async () => false;"),
  "@/spotify/askSpotify": stubModule("export const askSpotifyAccount = async () => null;"),
  "@/theme/useThemeColor": stubModule('export const useThemeColor = () => "red";'),
  "@/ytmusic/askYtMusic": stubModule(`
    import * as Result from ${result};
    export const askYtMusic = async () => Result.succeed([]);
  `),
  "./PickerSheetFrame": stubModule('export const PickerSheetFrame = "frame";'),
  "./ytLibraryImport": stubModule(`
    export const currentYtLibraryOrigins = async () => new Map();
    export const importYtLibrary = () => globalThis.pickerTest.importing();
  `),
};
const expoRequire = createRequire(createRequire(import.meta.url).resolve("expo/package.json"));
const presetRequire = createRequire(expoRequire.resolve("babel-preset-expo"));
const babel = presetRequire("@babel/core");
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = stubs[specifier];
    if (stub !== undefined) return { url: stub, shortCircuit: true };
    if (specifier === "@/catalog/grid") specifier = "../catalog/grid.ts";
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("/YtLibraryPicker.tsx")) {
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
let sheet: typeof import("./YtLibraryPicker.tsx");
try {
  sheet = await import("./YtLibraryPicker.tsx");
} finally {
  hooks.deregister();
}

interface Frame {
  readonly actions: readonly {
    readonly label: string;
    readonly disabled: boolean;
    readonly afterwards: () => Promise<boolean>;
  }[];
}

/** From YT Music's picker once its library is read: the frame's props. */
const readPicker = async (): Promise<Frame> => {
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(
      createElement(sheet.PickerSheet, { service: "ytMusic", onClosed: () => {} }),
    );
  });
  const frame = renderer?.root.findByType("frame" as never).props as Frame;
  act(() => renderer?.unmount());
  return frame;
};

beforeEach(() => {
  shared.errors.length = 0;
  shared.importing = async () => {};
});

test("Import says it started once the import has made its playlists", async () => {
  const { actions } = await readPicker();
  for (const action of actions) {
    assert.equal(action.disabled, false, action.label);
    const { promise, resolve: made } = Promise.withResolvers<void>();
    shared.importing = () => promise;
    let started: boolean | undefined;
    void action.afterwards().then((answer) => (started = answer));
    await Promise.resolve();
    assert.equal(started, undefined, "the playlists aren't made yet");
    made();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(started, true, action.label);
  }
  assert.deepEqual(shared.errors, []);
});

test("an Import that fails shows why and says it didn't start", async () => {
  shared.importing = async () => {
    throw new Error("no playlists");
  };
  const { actions } = await readPicker();
  for (const action of actions) assert.equal(await action.afterwards(), false, action.label);
  assert.deepEqual(shared.errors, ["Couldn't import the playlists", "Couldn't import the playlists"]);
});
