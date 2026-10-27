import assert from "node:assert/strict";
import { test } from "node:test";
import type { SearchOnline } from "@wave/core";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { ExternalStore } from "../lib/externalStore.ts";
import { reactCompilerBuilds, stubModule } from "../perf/reactCompilerBuilds.ts";

// Always on Wi-Fi reads the network once a visit, as written and as the React
// Compiler builds it.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const react = JSON.stringify(import.meta.resolve("react"));
const externalStore = JSON.stringify(new URL("../lib/externalStore.ts", import.meta.url).href);
/** The preference and the network, which counts its reads. */
const device = stubModule(
  `import { makeExternalStore } from ${externalStore};
   export const preference = makeExternalStore("wifi");
   export const network = { onMobileData: true, reads: 0 };`,
);
const builds = await reactCompilerBuilds<typeof import("./searchOnline.ts")>(
  new URL("./searchOnline.ts", import.meta.url).href,
  {
    "@/lib/persistedSetting": stubModule(
      `import { useSyncExternalStore } from ${react};
       import { preference } from ${JSON.stringify(device)};
       export const persistedSetting = () => ({
         get: preference.get,
         set: preference.set,
         useValue: () => useSyncExternalStore(preference.subscribe, preference.get),
       });`,
    ),
    "@/native/waveNative": stubModule(
      `import { network } from ${JSON.stringify(device)};
       export const onMobileData = () => { network.reads += 1; return network.onMobileData; };`,
    ),
    "@/overlay/titleChoices": stubModule(`export const openTitleChoices = () => {};`),
  },
);
const { preference, network } = (await import(device)) as {
  preference: ExternalStore<SearchOnline>;
  network: { onMobileData: boolean; reads: number };
};

for (const [build, { useSearchOnlineAlways }] of Object.entries(builds)) {
  test(`${build}: the network is read as the view opens, when the preference changes and on a new visit`, async () => {
    preference.set("wifi");
    network.onMobileData = true;
    network.reads = 0;
    const shown: boolean[] = [];
    function View({ visit, tick }: { visit: unknown; tick: number }) {
      shown.push(useSearchOnlineAlways(visit));
      return createElement("view", { tick });
    }
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(createElement(View, { visit: true, tick: 0 }));
      });
      assert.equal(network.reads, 1);
      assert.equal(shown.at(-1), false, "on mobile data, Always on Wi-Fi doesn't search");

      network.onMobileData = false;
      await act(() => renderer!.update(createElement(View, { visit: true, tick: 1 })));
      assert.equal(network.reads, 1, "a network change mid-visit isn't read");
      assert.equal(shown.at(-1), false);

      await act(() => renderer!.update(createElement(View, { visit: false, tick: 2 })));
      assert.equal(network.reads, 2, "a new visit reads the network");
      assert.equal(shown.at(-1), true);

      network.onMobileData = true;
      await act(() => preference.set("always"));
      assert.equal(network.reads, 3, "a preference change reads the network");
      assert.equal(shown.at(-1), true);
    } finally {
      await act(() => renderer?.unmount());
    }
  });
}
