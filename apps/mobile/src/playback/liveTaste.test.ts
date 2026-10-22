/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  magicArtistKey,
  tasteProfile,
  ytTrackId,
  type MagicSong,
  type TasteHistory,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { makeLiveTaste } from "./liveTaste.ts";

const NOW = 1_000_000_000;

const songOf = (trackId: string): MagicSong => ({
  trackId,
  artists: [magicArtistKey(`artist of ${trackId}`)],
  genre: "rock",
  style: null,
});

const NO_HISTORY: TasteHistory = { plays: [], favorites: [], downloads: [] };

/**
 * A live taste profile over [history] (read each time it's derived), whose
 * songs are each their own artist's.
 */
const liveTaste = (history: () => TasteHistory = () => NO_HISTORY) => {
  let hold: Promise<void> = Promise.resolve();
  const live = makeLiveTaste({
    derive: Effect.suspend(() => {
      const profile = tasteProfile(history(), songOf, NOW);
      return Effect.promise(() => hold).pipe(Effect.as(profile));
    }),
    songsOf: (trackIds) => Effect.succeed(trackIds.map(songOf)),
  });
  return {
    live,
    /** Holds every derivation until the returned function is called. */
    holdDerivation: () => {
      let release: (() => void) | undefined;
      hold = new Promise((resolve) => {
        release = resolve;
      });
      return () => release?.();
    },
  };
};

const songScore = async (live: ReturnType<typeof makeLiveTaste<never>>, trackId: string) =>
  (await Effect.runPromise(live.profile))?.songs.get(trackId) ?? 0;

const playedThrough = (trackId: string) => ({
  trackId,
  startedAt: NOW,
  listenedMs: 200_000,
  endReason: "completed" as const,
});

describe("The live taste profile", () => {
  test("learns a Library song's play end, not a streamed song's", async () => {
    const { live } = liveTaste();
    await Effect.runPromise(live.profile);
    const streamed = ytTrackId("abc");
    await Effect.runPromise(live.played(playedThrough("7")));
    await Effect.runPromise(live.played(playedThrough(streamed)));
    assert.equal(await songScore(live, "7"), 1);
    assert.equal(await songScore(live, streamed), 0);
  });

  test("a signal that comes while the profile is being derived counts once it is", async () => {
    const { live, holdDerivation } = liveTaste();
    const release = holdDerivation();
    const first = Effect.runPromise(live.profile);
    await Effect.runPromise(live.played(playedThrough("7")));
    await Effect.runPromise(live.marked("favorite", ["8"], NOW));
    release();
    assert.equal((await first)?.songs.get("7"), 1);
    assert.equal(await songScore(live, "8"), 3);
  });

  test("a signal before the profile was first asked for is left to the history", async () => {
    const { live } = liveTaste();
    await Effect.runPromise(live.played(playedThrough("7")));
    assert.equal(await songScore(live, "7"), 0);
  });

  test("unstarring a song takes its favorite back at once", async () => {
    let history: TasteHistory = { ...NO_HISTORY, favorites: [{ trackId: "7", changedAt: NOW }] };
    const { live } = liveTaste(() => history);
    assert.equal(await songScore(live, "7"), 3);
    history = NO_HISTORY;
    live.unstarred();
    assert.equal(await songScore(live, "7"), 0);
  });

  test("an unstar while the profile is being derived isn't lost", async () => {
    let history: TasteHistory = { ...NO_HISTORY, favorites: [{ trackId: "7", changedAt: NOW }] };
    const { live, holdDerivation } = liveTaste(() => history);
    const release = holdDerivation();
    const first = Effect.runPromise(live.profile);
    history = NO_HISTORY;
    live.unstarred();
    release();
    await first;
    assert.equal(await songScore(live, "7"), 0);
  });

  test("keeps a YT Music song's star and download", async () => {
    const { live } = liveTaste();
    await Effect.runPromise(live.profile);
    const streamed = ytTrackId("abc");
    await Effect.runPromise(live.marked("favorite", [streamed], NOW));
    await Effect.runPromise(live.marked("download", [streamed], NOW));
    assert.equal(await songScore(live, streamed), 5);
  });
});
