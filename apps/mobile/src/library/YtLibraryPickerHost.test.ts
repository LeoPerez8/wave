import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { beforeEach, test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { stubModule } from "../perf/reactCompilerBuilds.ts";

/**
 * Opening Export to YT Music: the account and the alert stubbed, each
 * writing what it was asked to `globalThis.openTest`; the test sets whether
 * the account is signed in, the alert's answer and the sign-in's.
 */
interface OpenTest {
  readonly calls: string[];
  signedIn: boolean;
  confirms: boolean;
  signsIn: boolean;
}
const shared: OpenTest = { calls: [], signedIn: false, confirms: false, signsIn: false };
Object.assign(globalThis, { openTest: shared, IS_REACT_ACT_ENVIRONMENT: true });

const core = JSON.stringify(import.meta.resolve("@wave/core"));
const store = JSON.stringify(import.meta.resolve("../lib/externalStore.ts"));
const stubs: Record<string, string> = {
  "@/lib/externalStore": stubModule(`export * from ${store};`),
  "@/localisation/localisation": stubModule(`
    import { catalogueOf } from ${core};
    export const currentLocalisation = () => ({ language: "en", strings: catalogueOf("en") });
  `),
  "@/overlay/alert": stubModule(`
    export const confirmAction = async (alert) => {
      globalThis.openTest.calls.push("alert " + alert.title + " / " + alert.action.label);
      return globalThis.openTest.confirms;
    };
  `),
  "@/settings/ytAccount": stubModule(`
    export const ytMusicSignedIn = async () => globalThis.openTest.signedIn;
    export const signInToYtMusic = async () => {
      globalThis.openTest.calls.push("sign in");
      return globalThis.openTest.signsIn;
    };
  `),
  "@/settings/spotifyAccount": stubModule(`
    export const spotifySignedIn = async () => globalThis.openTest.signedIn;
    export const signInToSpotify = async () => globalThis.openTest.signsIn;
  `),
  "./YtExportPicker": stubModule('export const ExportSheet = "export-sheet";'),
  "./YtLibraryPicker": stubModule('export const PickerSheet = "picker-sheet";'),
};
const expoRequire = createRequire(createRequire(import.meta.url).resolve("expo/package.json"));
const presetRequire = createRequire(expoRequire.resolve("babel-preset-expo"));
const babel = presetRequire("@babel/core");
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = stubs[specifier];
    if (stub !== undefined) return { url: stub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("/YtLibraryPickerHost.tsx")) {
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
let host: typeof import("./YtLibraryPickerHost.tsx");
try {
  host = await import("./YtLibraryPickerHost.tsx");
} finally {
  hooks.deregister();
}

/** The picker the host draws now, if any. */
const picker = (): string | null => {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(host.YtLibraryPickerHost));
  });
  const json = renderer?.toJSON();
  act(() => renderer?.unmount());
  return json === null || json === undefined || Array.isArray(json) ? null : json.type;
};

/** Closes whatever picker is up, as its sheet going down does. */
const closePicker = (imported = false) => {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(host.YtLibraryPickerHost));
  });
  const sheet = renderer?.root.findAll((node) => typeof node.props.onClosed === "function")[0];
  act(() => sheet?.props.onClosed(imported));
  act(() => renderer?.unmount());
};

beforeEach(() => {
  closePicker();
  shared.calls.length = 0;
  shared.signedIn = false;
  shared.confirms = false;
  shared.signsIn = false;
});

test("signed in, Export opens its picker at once", async () => {
  shared.signedIn = true;
  await host.openYtExport();
  assert.deepEqual(shared.calls, []);
  assert.equal(picker(), "export-sheet");
});

test("signed out, Export asks with Share's sign-in alert, then signs in and opens its picker", async () => {
  shared.confirms = true;
  shared.signsIn = true;
  await host.openYtExport();
  assert.deepEqual(shared.calls, ["alert Sign In to YT Music / Sign In", "sign in"]);
  assert.equal(picker(), "export-sheet");
});

test("declining the alert opens neither the sign-in nor the picker", async () => {
  await host.openYtExport();
  assert.deepEqual(shared.calls, ["alert Sign In to YT Music / Sign In"]);
  assert.equal(picker(), null);
});

test("leaving the sign-in opens nothing", async () => {
  shared.confirms = true;
  await host.openYtExport();
  assert.deepEqual(shared.calls, ["alert Sign In to YT Music / Sign In", "sign in"]);
  assert.equal(picker(), null);
});

test("both library imports report Import or cancellation only after their picker closes", async () => {
  shared.signedIn = true;
  for (const open of [host.openSpotifyLibraryImport, host.openYtLibraryImport]) {
    for (const imported of [true, false]) {
      const answers: boolean[] = [];
      await open((answer) => answers.push(answer));
      assert.equal(picker(), "picker-sheet");
      assert.deepEqual(answers, [], "opening the picker isn't an import");
      closePicker(imported);
      assert.deepEqual(answers, [imported]);
    }
  }
});

test("both library imports return after sign-in cancellation, or wait for the signed-in picker", async () => {
  for (const open of [host.openSpotifyLibraryImport, host.openYtLibraryImport]) {
    const answers: boolean[] = [];
    shared.signsIn = false;
    await open((answer) => answers.push(answer));
    assert.equal(picker(), null);
    assert.deepEqual(answers, [false]);

    shared.signsIn = true;
    answers.length = 0;
    await open((answer) => answers.push(answer));
    assert.equal(picker(), "picker-sheet");
    assert.deepEqual(answers, []);
    closePicker(true);
    assert.deepEqual(answers, [true]);
  }
});
