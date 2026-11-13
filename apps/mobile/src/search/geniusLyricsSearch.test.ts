import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import type { SongLookup } from "@wave/core";
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

for (const [build, { requestGeniusLyricsSearch }] of Object.entries(builds)) {
  test(`${build}: Genius lyric search asks with the phrase and keeps covers and credits`, async () => {
    const paths: string[] = [];
    const answer = await requestGeniusLyricsSearch("teardrop massive attack", {
      enabled: true,
      signedIn: true,
      isOnline: () => true,
      ask: async (path) => {
        paths.push(path);
        return reply;
      },
    });
    assert.deepEqual(paths, ["/v1/genius/search?q=teardrop%20massive%20attack"]);
    assert.deepEqual(answer, {
      query: "teardrop massive attack",
      status: "hits",
      hits: [
        {
          id: 8,
          title: "Teardrop",
          artist: "Massive Attack",
          credit: "Massive Attack",
          url: "https://genius.com/Massive-attack-teardrop-lyrics",
          artworkUrl: "https://images.example/teardrop.jpg",
        },
      ],
    });
  });

  test(`${build}: signed-out, offline and disabled searches do not ask the Worker`, async () => {
    let calls = 0;
    const ask = async () => {
      calls += 1;
      return reply;
    };
    const base = { enabled: true, signedIn: true, isOnline: () => true, ask };
    assert.equal((await requestGeniusLyricsSearch("one two", base)).status, "idle");
    assert.equal(
      (await requestGeniusLyricsSearch("one two three", { ...base, signedIn: false })).status,
      "signedOut",
    );
    assert.equal(
      (await requestGeniusLyricsSearch("one two three", { ...base, isOnline: () => false })).status,
      "offline",
    );
    assert.equal(
      (await requestGeniusLyricsSearch("one two three", { ...base, enabled: false })).status,
      "disabled",
    );
    assert.equal(calls, 0);
  });

  test(`${build}: unreadable replies fail, and a lost connection settles as offline`, async () => {
    const base = { enabled: true, signedIn: true, isOnline: () => true };
    assert.equal(
      (
        await requestGeniusLyricsSearch("one two three", {
          ...base,
          ask: async () => ({ meta: { status: 502 } }),
        })
      ).status,
      "failed",
    );
    let connected = true;
    const answer = await requestGeniusLyricsSearch("one two three", {
      ...base,
      isOnline: () => connected,
      ask: async () => {
        connected = false;
        throw new Error("connection lost");
      },
    });
    assert.equal(answer.status, "offline");
  });
}

for (const [build, { useGeniusLyricsSearch }] of Object.entries(builds)) {
  test(`${build}: Try Again asks Genius again`, async () => {
    requests.length = 0;
    const seen: ReturnType<typeof useGeniusLyricsSearch>[] = [];
    const library: never[] = [];
    function View() {
      const controller = useGeniusLyricsSearch("one two three", library, true);
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
  test(`${build}: a Library re-read keeps Genius's answer and asks nothing again`, async () => {
    requests.length = 0;
    worker.reply = reply;
    const seen: ReturnType<typeof useGeniusLyricsSearch>[] = [];
    function View({ library }: { library: readonly SongLookup[] }) {
      seen.push(useGeniusLyricsSearch("teardrop massive attack", library, true));
      return createElement("view");
    }

    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(createElement(View, { library: [] }));
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 360)));
      assert.equal(requests.length, 1);
      assert.equal(seen.at(-1)?.state.status, "hits");

      // A scan batch or a play count re-reads the Library: a new list, the same query.
      await act(async () => {
        renderer?.update(
          createElement(View, {
            library: [{ title: "Angel", artist: "Massive Attack", album: null, durationMs: 0 }],
          }),
        );
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 360)));
      assert.equal(requests.length, 1);
      const kept = seen.at(-1)?.state;
      assert.equal(kept?.status, "hits");
      assert.equal(kept?.status === "hits" ? kept.hits.length : -1, 1);

      // The Library gains the song: its row leaves the Genius hits, still without asking again.
      await act(async () => {
        renderer?.update(
          createElement(View, {
            library: [{ title: "Teardrop", artist: "Massive Attack", album: null, durationMs: 0 }],
          }),
        );
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 360)));
      assert.equal(requests.length, 1);
      assert.deepEqual(seen.at(-1)?.state, {
        query: "teardrop massive attack",
        status: "hits",
        hits: [],
      });
    } finally {
      worker.reply = { meta: { status: 502 } };
      await act(() => renderer?.unmount());
    }
  });
}
