import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { reactCompilerBuilds, stubModule } from "../perf/reactCompilerBuilds.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// The phone's connectivity, which a test turns off and on, and what YT Music was asked.
const phone = stubModule(
  `export const asked = [];
   export const endpoints = [];
   const listeners = new Set();
   export const network = { online: true };
   export const setOnline = (next) => {
     network.online = next;
     for (const listener of listeners) listener();
   };
   export const subscribe = (listener) => {
     listeners.add(listener);
     return () => listeners.delete(listener);
   };`,
);
const builds = await reactCompilerBuilds<typeof import("./ytMusicSearch.ts")>(
  new URL("./ytMusicSearch.ts", import.meta.url).href,
  {
    "@/native/waveNative": stubModule(
      `import { network, subscribe } from ${JSON.stringify(phone)};
       export const online = () => network.online;
       export const subscribeConnectivity = subscribe;`,
    ),
    "@/settings/searchOnline": stubModule("export const useSearchOnlineAlways = () => false;"),
    "@/settings/ytMusic": stubModule("export const useYtMusicEnabled = () => true;"),
    // Asked, never answered: the test counts the requests and the endpoints each one names.
    "@/ytmusic/askYtMusic": stubModule(
      `import { asked, endpoints } from ${JSON.stringify(phone)};
       const pending = { pipe: () => pending };
       const ytMusic = new Proxy({}, {
         get: (_, name) => () => {
           endpoints.push(String(name));
           return pending;
         },
       });
       export const askYtMusic = (ask) => {
         asked.push(1);
         try {
           ask(ytMusic);
         } catch {}
         return new Promise(() => {});
       };`,
    ),
    "@/ytmusic/searchAllowance": stubModule(
      "export const withSearchTurn = (_kind, _query, search) => search;",
    ),
  },
);
const { asked, endpoints, setOnline } = (await import(phone)) as {
  asked: number[];
  endpoints: string[];
  setOnline: (next: boolean) => void;
};

const pause = () => act(() => new Promise((resolve) => setTimeout(resolve, 360)));

for (const [build, { useYtMusicSection, useYtMusicSongsSection }] of Object.entries(builds)) {
  test(`${build}: Add Songs waits for connectivity before its settled search`, async () => {
    asked.length = 0;
    endpoints.length = 0;
    setOnline(false);
    function View() {
      useYtMusicSongsSection("daft punk");
      return createElement("view");
    }

    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(createElement(View));
      });
      await pause();
      assert.equal(asked.length, 0);

      await act(async () => setOnline(true));
      await pause();
      assert.equal(asked.length, 1);
      assert.deepEqual(endpoints, ["searchSongs"]);
    } finally {
      await act(() => renderer?.unmount());
      setOnline(true);
    }
  });

  test(`${build}: DJ's search asks YT Music once the phone is back online`, async () => {
    asked.length = 0;
    setOnline(false);
    const seen: string[] = [];
    function View() {
      const [section] = useYtMusicSection("daft punk", true, { artistsAndAlbums: true });
      seen.push(section.status);
      return createElement("view");
    }

    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(createElement(View));
      });
      await pause();
      assert.equal(asked.length, 0);
      assert.notEqual(seen.at(-1), "loading");

      await act(async () => setOnline(true));
      await pause();
      assert.equal(seen.at(-1), "loading");
      assert.equal(asked.length, 1);
    } finally {
      await act(() => renderer?.unmount());
      setOnline(true);
    }
  });

  test(`${build}: the Search tab asks whatever the phone's connectivity says`, async () => {
    asked.length = 0;
    setOnline(false);
    function View() {
      useYtMusicSection("daft punk", false);
      return createElement("view");
    }

    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(createElement(View));
      });
      await pause();
      assert.equal(asked.length, 1);
      await act(async () => setOnline(true));
      await pause();
      assert.equal(asked.length, 1);
    } finally {
      await act(() => renderer?.unmount());
      setOnline(true);
    }
  });
}
