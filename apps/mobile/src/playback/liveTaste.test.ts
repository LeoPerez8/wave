/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  magicArtistKey,
  tasteProfile,
  tasteLearned,
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
    assert.equal((await first)?.songs.get("7") ?? 0, 0);
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

test("cancelling a cold profile preserves streamed signals for the next shared request", async () => {
  let finish: (() => void) | undefined;
  const read = Effect.callback<ReturnType<typeof tasteProfile>>((resume) => {
    finish = () => resume(Effect.succeed(tasteProfile(NO_HISTORY, songOf, NOW)));
  });
  const live = makeLiveTaste({ derive: read, songsOf: (ids) => Effect.succeed(ids.map(songOf)) });
  const controller = new AbortController();
  const first = Effect.runPromise(live.profile, { signal: controller.signal });
  await Effect.runPromise(live.marked("favorite", [ytTrackId("held")], NOW));
  controller.abort();
  await assert.rejects(first);
  const second = Effect.runPromise(live.profile);
  finish!();
  assert.equal((await second)?.songs.get(ytTrackId("held")), 3);
});

test("pending streamed and Library signals retain their arrival order in the complete profile", async () => {
  let finish: (() => void) | undefined;
  const base = tasteProfile(NO_HISTORY, songOf, NOW);
  const live = makeLiveTaste({
    derive: Effect.callback<typeof base>((resume) => {
      finish = () => resume(Effect.succeed(base));
    }),
    songsOf: (ids) => Effect.succeed(ids.map(songOf)),
  });
  const request = Effect.runPromise(live.profile);
  const ids = [ytTrackId("first"), "7", ytTrackId("last")];
  for (const id of ids) await Effect.runPromise(live.marked("favorite", [id], NOW));
  finish!();
  const expected = ids.reduce(
    (profile, id) => tasteLearned(profile, { kind: "favorite", song: songOf(id), at: NOW }),
    base,
  );
  const actual = await request;
  assert.deepEqual([...actual!.songs], [...expected.songs]);
  assert.deepEqual([...actual!.artists], [...expected.artists]);
  assert.deepEqual([...actual!.genres], [...expected.genres]);
});

test("cold live-profile snapshot reconciliation yields over history even with pending signals", async () => {
  const history: TasteHistory = {
    ...NO_HISTORY,
    plays: Array.from({ length: 2000 }, () => playedThrough("7")),
  };
  let finish: (() => void) | undefined;
  let turns = 0;
  const read = (snapshot: (history: TasteHistory) => void) =>
    Effect.callback<ReturnType<typeof tasteProfile>>((resume) => {
      finish = () => {
        snapshot(history);
        resume(Effect.succeed(tasteProfile(history, songOf, NOW)));
      };
    });
  const live = makeLiveTaste({
    derive: read(() => {}),
    deriveWithSnapshot: read,
    songsOf: (ids) => Effect.succeed(ids.map(songOf)),
    between: Effect.sync(() => {
      turns++;
    }),
  });
  const first = Effect.runPromise(live.profile);
  await Effect.runPromise(live.played(playedThrough("7")));
  await Effect.runPromise(live.marked("favorite", [ytTrackId("new")], NOW));
  finish!();
  assert.equal((await first)?.songs.get("7"), 2000);
  assert.ok(turns >= 4, "history membership work must pause at the canonical operation cap");
});

test("streamed signals during Home's Library walk and across metadata invalidation remain learned", async () => {
  const { live } = liveTaste();
  const id = ytTrackId("during-library-mapping");
  await Effect.runPromise(live.marked("favorite", [id], NOW));
  assert.equal(await songScore(live, id), 3);
  live.invalidate();
  assert.equal(await songScore(live, id), 3);
  live.unstarred([id]);
  assert.equal(await songScore(live, id), 0);
});

test("due Home and mixes keep one live profile; a later history snapshot counts each signal once", async () => {
  let history: TasteHistory = NO_HISTORY;
  let takeSnapshot: (() => void) | undefined;
  let reads = 0;
  const read = (snapshotTaken: (history: TasteHistory) => void) =>
    Effect.callback<ReturnType<typeof tasteProfile>>((resume) => {
      reads++;
      takeSnapshot = () => {
        const profile = tasteProfile(history, songOf, NOW);
        snapshotTaken(history);
        resume(Effect.succeed(profile));
      };
    });
  const live = makeLiveTaste({
    derive: read(() => {}),
    deriveWithSnapshot: read,
    songsOf: (ids) => Effect.succeed(ids.map(songOf)),
  });
  const first = Effect.runPromise(live.profileUsing(read));
  // Came while the derivation waited for its turn, and are in the history it then reads.
  history = {
    ...NO_HISTORY,
    plays: [playedThrough("8")],
    favorites: [{ trackId: "7", changedAt: NOW }],
  };
  await Effect.runPromise(live.marked("favorite", ["7"], NOW));
  await Effect.runPromise(live.played(playedThrough("8")));
  // A star announced before its write landed: not in the history read.
  await Effect.runPromise(live.marked("favorite", ["9"], NOW));
  await Effect.runPromise(live.marked("favorite", [ytTrackId("streamed")], NOW));
  takeSnapshot!();
  const firstProfile = await first;
  assert.equal(firstProfile?.songs.get("7"), 3);
  assert.equal(firstProfile?.songs.get("8"), 1);
  assert.equal(firstProfile?.songs.get("9"), 3);
  assert.equal(firstProfile?.songs.get(ytTrackId("streamed")), 3);
  // After the snapshot, a signal is learned on top of it.
  const second = await Effect.runPromise(live.profile);
  assert.equal(second?.songs.get("7"), 3);
  assert.equal(reads, 1);
  await Effect.runPromise(live.marked("download", ["7"], NOW));
  assert.equal((await Effect.runPromise(live.profileUsing(read)))?.songs.get("7"), 5);
  assert.equal(reads, 1);
});

test("metadata changing during every derivation can't keep the profile from coming: the third answers, unkept", async () => {
  let derivations = 0;
  let invalidating = 3;
  const live = makeLiveTaste({
    derive: Effect.suspend(() => {
      derivations++;
      // A scan batch landing while each derivation runs.
      if (invalidating-- > 0) live.invalidate();
      return Effect.succeed(tasteProfile(NO_HISTORY, songOf, NOW));
    }),
    songsOf: (ids) => Effect.succeed(ids.map(songOf)),
  });
  assert.notEqual(await Effect.runPromise(live.profile), null);
  assert.equal(derivations, 3, "bounded, not one more per change");
  // An answer changed meanwhile isn't the shared one: the next ask derives again.
  await Effect.runPromise(live.profile);
  assert.equal(derivations, 4);
  await Effect.runPromise(live.profile);
  assert.equal(derivations, 4);
});
