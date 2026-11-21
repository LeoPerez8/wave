import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { reactCompilerBuilds, stubModule } from "../perf/reactCompilerBuilds.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const requestsModule = stubModule(
  "export const requests = []; export const worker = { reply: { meta: { status: 502 } } };",
);
const builds = await reactCompilerBuilds<typeof import("./geniusLyricsSearch.ts")>(
  new URL("./geniusLyricsSearch.ts", import.meta.url).href,
  {
    "@/settings/genius": stubModule("export const useGeniusInsightsEnabled = () => true;"),
    "@/native/waveNative": stubModule(
      "export const online = () => true; export const subscribeConnectivity = () => () => {};",
    ),
    "@/sync/askWaveService": stubModule(
      `import { requests, worker } from ${JSON.stringify(requestsModule)};
       export const askWaveService = async (path) => {
         requests.push(path);
         return worker.reply;
       };`,
    ),
    "@/sync/waveSignedIn": stubModule("export const useWaveSignedIn = () => true;"),
  },
);
const { requests, worker } = (await import(requestsModule)) as {
  requests: string[];
  worker: { reply: unknown };
};

const reply = {
  meta: { status: 200 },
  response: {
    hits: [
      {
        type: "song",
        result: {
          id: 8,
          title: "Teardrop",
          primary_artist: { name: "Massive Attack" },
          artist_names: "Massive Attack",
          url: "https://genius.com/Massive-attack-teardrop-lyrics",
          song_art_image_thumbnail_url: "https://images.example/teardrop.jpg",
        },
      },
    ],
  },
};

for (const [build, { useGeniusLyricsSearch }] of Object.entries(builds)) {
  test(`${build}: Try Again asks Genius again`, async () => {
    requests.length = 0;
    const seen: ReturnType<typeof useGeniusLyricsSearch>[] = [];
    function View() {
      const controller = useGeniusLyricsSearch("one two three", true);
      seen.push(controller);
      return createElement("view");
    }

    let renderer: ReactTestRenderer | undefined;
    try {
      // Effects run when act's callback ends, so the typing pause is waited out in its own act.
      await act(async () => {
        renderer = create(createElement(View));
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 360)));
      assert.equal(seen.at(-1)?.state.status, "failed");
      assert.equal(requests.length, 1);

      await act(async () => {
        seen.at(-1)?.retry();
      });
      assert.equal(seen.at(-1)?.state.status, "loading");
      await act(() => new Promise((resolve) => setTimeout(resolve, 360)));
      assert.equal(requests.length, 2);
      assert.equal(seen.at(-1)?.state.status, "failed");
    } finally {
      await act(() => renderer?.unmount());
    }
  });
}

for (const [build, { useGeniusLyricsSearch }] of Object.entries(builds)) {
  test(`${build}: a Library re-read keeps Genius's whole answer and asks nothing again`, async () => {
    requests.length = 0;
    worker.reply = reply;
    const seen: ReturnType<typeof useGeniusLyricsSearch>[] = [];
    // Search re-renders on a scan batch or a play count.
    function View() {
      seen.push(useGeniusLyricsSearch("teardrop massive attack", true));
      return createElement("view");
    }

    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(createElement(View));
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 360)));
      assert.equal(requests.length, 1);
      assert.equal(seen.at(-1)?.state.status, "hits");

      // The Library may now hold the song. Its hit stays in the answer: Search's rows leave it
      // out only while a local result shows the song (#1111).
      await act(async () => {
        renderer?.update(createElement(View));
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 360)));
      assert.equal(requests.length, 1);
      const kept = seen.at(-1)?.state;
      assert.equal(kept?.status, "hits");
      assert.deepEqual(kept?.status === "hits" ? kept.hits.map((hit) => hit.title) : [], [
        "Teardrop",
      ]);
    } finally {
      worker.reply = { meta: { status: 502 } };
      await act(() => renderer?.unmount());
    }
  });
}
