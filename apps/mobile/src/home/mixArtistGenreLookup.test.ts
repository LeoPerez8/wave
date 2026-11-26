import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";

import { loadWithStubs, stubModule } from "../perf/renderHarness.ts";

const HARNESS = "__mixArtistGenreLookupTest";
const harness = { saved: [] as string[] };
Object.assign(globalThis, { [HARNESS]: harness });

const effect = JSON.stringify(import.meta.resolve("effect/Effect"));
const [{ queueMixArtistGenres }] = await loadWithStubs<
  [typeof import("./mixArtistGenreLookup.ts")]
>([import.meta.resolve("./mixArtistGenreLookup.ts")], {
  "react-native": stubModule(
    `export const AppState = { currentState: "active", addEventListener: () => ({ remove() {} }) };`,
  ),
  "@/lib/backgroundWork": stubModule(
    `import * as Effect from ${effect};
     export const freeTurnAlone = async () => {};
     export const freeTurnEffect = Effect.void;
     export const inSlice = (_name, run) => run();`,
  ),
  "@/native/waveNative": stubModule(
    `export const online = () => true;
     export const subscribeConnectivity = () => () => {};`,
  ),
  "@/settings/ytMusic": stubModule(
    `export const ytMusicEnabled = () => true;
     export const subscribeYtMusicEnabled = () => () => {};`,
  ),
  "./artistGenres": stubModule(
    `export const genreMixArtistDue = () => true;
     export const saveGenreMixArtistProfile = (name) => globalThis.${HARNESS}.saved.push(name);`,
  ),
});

/** Deezer as the lookup reads it: the artist found, one album of [genre]. */
const deezer = (genre: string) => async (input: string | URL | Request) => {
  const url = String(input);
  const body = url.includes("/search/artist")
    ? { data: [{ id: 1, type: "artist", name: new URL(url).searchParams.get("q"), nb_fan: 10 }] }
    : url.includes("/albums")
      ? { data: [{ id: 2 }] }
      : { id: 2, genres: { data: [{ name: genre }] } };
  return new Response(JSON.stringify(body), { status: 200 });
};

test("the lookups a build queued run inside its Effect, and the build hears when they're done", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = deezer("Rock") as typeof fetch;
  try {
    let lookups = 0;
    let bytes = 0;
    let settled = 0;
    const meter = {
      lookup: () => lookups++,
      received: (size: number) => {
        bytes += size;
      },
      settled: () => settled++,
    };
    await Effect.runPromise(
      queueMixArtistGenres([{ artists: ["Band One", "Band Two"] }], () => undefined, meter),
    );
    assert.deepEqual(harness.saved, ["Band One", "Band Two"]);
    assert.equal(lookups, 2, "each artist looked up counts once");
    assert.ok(bytes > 0, "Deezer's answers count as data received");
    assert.equal(settled, 1, "the build hears once that its last lookup finished");
  } finally {
    globalThis.fetch = realFetch;
  }
});
