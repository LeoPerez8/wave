import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, memo, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { ExternalStore } from "../lib/externalStore.ts";
import { reactCompilerBuilds, stubModule } from "../perf/reactCompilerBuilds.ts";

// The Portuguese (preview) switch re-renders what reads the catalogue at once,
// as written and as the React Compiler builds it, without remounting it.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const externalStore = JSON.stringify(new URL("../lib/externalStore.ts", import.meta.url).href);
/** The switch, and the phone's languages (Android's, through the native layer). */
const device = stubModule(
  `import { makeExternalStore } from ${externalStore};
   export const preview = makeExternalStore(false);
   export const localeChanged = makeExternalStore(0);
   export const phone = { languages: ["pt-BR", "en-US"], preview: false };`,
);
const builds = await reactCompilerBuilds<typeof import("./localisation.ts")>(
  new URL("./localisation.ts", import.meta.url).href,
  {
    "@/settings/portuguesePreview": stubModule(
      `import { preview } from ${JSON.stringify(device)};
       export const portuguesePreview = preview.get;
       export const subscribePortuguesePreview = preview.subscribe;`,
    ),
    "@/native/waveNative": stubModule(
      `import { phone, localeChanged } from ${JSON.stringify(device)};
       export const WaveNative = { setPortuguesePreview: (enabled) => { phone.preview = enabled; } };
       export const phoneLanguages = () => phone.languages;
       export const subscribePhoneLanguages = localeChanged.subscribe;`,
    ),
  },
);
const { preview, phone, localeChanged } = (await import(device)) as {
  preview: ExternalStore<boolean>;
  phone: { languages: string[]; preview: boolean };
  localeChanged: ExternalStore<number>;
};
const changeLanguages = (languages: string[]) => {
  phone.languages = languages;
  localeChanged.set(localeChanged.get() + 1);
};

for (const [build, localisation] of Object.entries(builds)) {
  const { LocalisationProvider, useLocalisation, currentLocalisation } = localisation;

  test(`${build}: flipping Portuguese (preview) re-renders the tab names in place`, async () => {
    changeLanguages(["pt-BR", "en-US"]);
    preview.set(false);
    const shown: string[] = [];
    let mounts = 0;
    // Memoized, as the tab bar is: only the catalogue can re-render it.
    const Tab = memo(function Tab() {
      const { language, strings } = useLocalisation();
      shown.push(`${language} ${strings.tabs.index}`);
      useEffect(() => {
        mounts += 1;
      }, []);
      return createElement("tab");
    });
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(createElement(LocalisationProvider, null, createElement(Tab)));
      });
      assert.equal(shown.at(-1), "en Home", "off, a Portuguese phone reads in English");
      assert.equal(currentLocalisation().strings.tabs.index, "Home");

      await act(() => preview.set(true));
      assert.equal(shown.at(-1), "pt-BR Início", "on, it reads in Portuguese at once");
      assert.equal(currentLocalisation().language, "pt-BR", "services read the same value");
      assert.equal(phone.preview, true, "native services receive the preview gate");

      await act(() => preview.set(false));
      assert.equal(shown.at(-1), "en Home");
      assert.equal(phone.preview, false);
      assert.equal(mounts, 1, "the screen isn't remounted");
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  test(`${build}: Android language changes update screens and services without remounting`, async () => {
    changeLanguages(["en-US"]);
    preview.set(true);
    let mounts = 0;
    const shown: string[] = [];
    const Tab = memo(function Tab() {
      shown.push(useLocalisation().strings.tabs.index);
      useEffect(() => {
        mounts += 1;
      }, []);
      return createElement("tab");
    });
    let renderer: ReactTestRenderer | undefined;
    const serviceLanguages: string[] = [];
    const stop = localisation.subscribeLocalisation(() => {
      serviceLanguages.push(currentLocalisation().language);
    });
    try {
      await act(() => {
        renderer = create(createElement(LocalisationProvider, null, createElement(Tab)));
      });
      assert.equal(shown.at(-1), "Home");
      await act(() => changeLanguages(["pt-BR"]));
      assert.equal(shown.at(-1), "Início");
      assert.equal(serviceLanguages.at(-1), "pt-BR");
      await act(() => changeLanguages(["en-GB"]));
      assert.equal(shown.at(-1), "Home");
      assert.equal(serviceLanguages.at(-1), "en");
      await act(() => changeLanguages(["pt-PT", "en-US"]));
      assert.equal(shown.at(-1), "Início", "system Portuguese also resolves to pt-BR");
      await act(() => preview.set(false));
      await act(() => changeLanguages(["en-US"]));
      await act(() => changeLanguages(["pt-BR"]));
      assert.equal(shown.at(-1), "Home", "Android's picker cannot bypass preview's gate");
      assert.equal(currentLocalisation().language, "en");
      assert.equal(mounts, 1, "locale changes preserve the mounted player and its state");
    } finally {
      stop();
      await act(() => renderer?.unmount());
    }
    changeLanguages(["en-US"]);
    preview.set(true);
    assert.equal(
      currentLocalisation().language,
      "en",
      "the locale cache stays fresh without a mounted provider",
    );
  });
}
