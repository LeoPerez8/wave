import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";

import { loadWithStubs, stubModule } from "../perf/renderHarness.ts";

const HARNESS = "__mixArtistGenreLookupTest";
const harness = {
  saved: [] as string[],
  /** A free turn: at once unless a test holds it, as a tap's transition does. */
  turn: async (): Promise<void> => {},
};
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
     export const freeTurnAlone = () => globalThis.${HARNESS}.turn();
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

test("an answer that arrives during a tap's transition waits for the next free turn", async () => {
  const realFetch = globalThis.fetch;
  const realTurn = harness.turn;
  harness.saved.length = 0;
  const held: (() => void)[] = [];
  let holding = false;
  let tapped = false;
  harness.turn = () =>
    holding ? new Promise<void>((resolve) => held.push(resolve)) : Promise.resolve();
  const answer = deezer("Jazz");
  globalThis.fetch = (async (input: string | URL | Request) => {
    // The owner taps while the first request is out: its answer comes back mid-transition.
    if (!tapped) holding = tapped = true;
    return answer(input);
  }) as typeof fetch;
  try {
    let bytes = 0;
    const meter = {
      lookup: () => {},
      received: (size: number) => {
        bytes += size;
      },
    };
    const run = Effect.runPromise(
      queueMixArtistGenres([{ artists: ["Band Three"] }], () => undefined, meter),
    );
    // Past the 400 ms between two Deezer requests, which the test before may have started.
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(bytes, 0, "no answer is read while the transition holds the turns");
    assert.ok(held.length > 0, "the lookup waits for a turn");
    holding = false;
    for (const resolve of held.splice(0)) resolve();
    await run;
    assert.ok(bytes > 0, "the answers are read once the transition is over");
    assert.deepEqual(harness.saved, ["Band Three"]);
  } finally {
    globalThis.fetch = realFetch;
    harness.turn = realTurn;
  }
});
