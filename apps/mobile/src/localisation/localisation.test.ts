import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, memo, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { ExternalStore } from "../lib/externalStore.ts";
import { reactCompilerBuilds, stubModule } from "../perf/reactCompilerBuilds.ts";

// A phone in Portuguese reads Wave in Portuguese with no switch, and Android's
// language changes re-render what reads the catalogue at once, as written and as
// the React Compiler builds it, without remounting it.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const externalStore = JSON.stringify(new URL("../lib/externalStore.ts", import.meta.url).href);
/** The phone's languages (Android's, through the native layer). */
const device = stubModule(
  `import { makeExternalStore } from ${externalStore};
   export const localeChanged = makeExternalStore(0);
   export const phone = { languages: ["pt-BR", "en-US"] };`,
);
const builds = await reactCompilerBuilds<typeof import("./localisation.ts")>(
  new URL("./localisation.ts", import.meta.url).href,
  {
    "@/native/waveNative": stubModule(
      `import { phone, localeChanged } from ${JSON.stringify(device)};
       export const phoneLanguages = () => phone.languages;
       export const subscribePhoneLanguages = localeChanged.subscribe;`,
    ),
  },
);
const { phone, localeChanged } = (await import(device)) as {
  phone: { languages: string[] };
  localeChanged: ExternalStore<number>;
};
const changeLanguages = (languages: string[]) => {
  phone.languages = languages;
  localeChanged.set(localeChanged.get() + 1);
};

for (const [build, localisation] of Object.entries(builds)) {
  const { LocalisationProvider, useLocalisation, currentLocalisation } = localisation;

  test(`${build}: a phone in Portuguese reads in Portuguese, with no switch`, async () => {
    changeLanguages(["pt-BR", "en-US"]);
    const shown: string[] = [];
    const Tab = memo(function Tab() {
      const { language, strings } = useLocalisation();
      shown.push(`${language} ${strings.tabs.index}`);
      return createElement("tab");
    });
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(createElement(LocalisationProvider, null, createElement(Tab)));
      });
      assert.equal(shown.at(-1), "pt-BR Início");
      assert.equal(currentLocalisation().language, "pt-BR", "services read the same value");
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  test(`${build}: Android language changes update screens and services without remounting`, async () => {
    changeLanguages(["en-US"]);
    let mounts = 0;
    const shown: string[] = [];
    // Memoized, as the tab bar is: only the catalogue can re-render it.
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
      assert.equal(shown.at(-1), "Home", "English is unchanged");
      await act(() => changeLanguages(["pt-BR"]));
      assert.equal(shown.at(-1), "Início");
      assert.equal(serviceLanguages.at(-1), "pt-BR");
      await act(() => changeLanguages(["en-GB"]));
      assert.equal(shown.at(-1), "Home");
      assert.equal(serviceLanguages.at(-1), "en");
      await act(() => changeLanguages(["pt-PT", "en-US"]));
      assert.equal(shown.at(-1), "Início", "system Portuguese also resolves to pt-BR");
      assert.equal(mounts, 1, "locale changes preserve the mounted player and its state");
    } finally {
      stop();
      await act(() => renderer?.unmount());
    }
    changeLanguages(["en-US"]);
    assert.equal(
      currentLocalisation().language,
      "en",
      "the locale cache stays fresh without a mounted provider",
    );
  });
}
