import assert from "node:assert/strict";
import { test } from "node:test";
import {
  playlistRecommendationSession,
  type PlaylistRecommendationFeedback,
  type PlaylistRecommendationTiming,
  type PlaylistRecommendationTrack,
} from "./index.ts";

const track = (id: string): PlaylistRecommendationTrack => ({
  id,
  source: "library",
  videoId: "",
  title: id,
  artists: [`Artist ${id}`],
  album: "OK Computer",
  albumId: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
  genre: "Rock",
});

const stream = (id: string): PlaylistRecommendationTrack => ({
  ...track(id),
  source: "stream",
  videoId: id,
});

const lettered = (text: string) => text.split("").map(track);

/** A session opening on [saved], as a visit to a playlist that's been visited does. */
const savedSession = (
  saved: readonly PlaylistRecommendationTrack[],
  options: {
    readonly online?: boolean;
    readonly report?: (timing: PlaylistRecommendationTiming) => void;
  } = {},
) => {
  const seed = track("seed");
  const gate = {
    reads: 0,
    online: options.online ?? true,
    fail: false,
    hold: undefined as PromiseWithResolvers<void> | undefined,
    signals: [] as (AbortSignal | undefined)[],
    playlist: [seed],
    library: [seed, ...lettered("abcdefghijklmnopqrstuvwxyz")],
    feedback: [] as PlaylistRecommendationFeedback[],
    written: [] as (readonly PlaylistRecommendationTrack[])[],
  };
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => `key${++id}`,
    read: async (signal) => {
      gate.reads++;
      gate.signals.push(signal);
      const hold = gate.hold;
      gate.hold = undefined;
      await hold?.promise;
      if (gate.fail) throw new Error("read failed");
      return {
        playlist: gate.playlist,
        sources: {
          // The radios bring what the Library holds of a through z, not the saved offers' copies.
          library: gate.library,
          pages: [{ id: "song:seed", artists: ["Artist seed"], songs: gate.library }],
          graph: null,
          feedback: gate.feedback,
          online: gate.online,
        },
      };
    },
    dismiss: async () => {},
    accept: async (offer) => {
      gate.playlist = [...gate.playlist, offer.track];
    },
    saved: {
      offers: saved,
      online: () => gate.online,
      write: (offers) => gate.written.push(offers),
    },
    ...(options.report === undefined ? {} : { timed: { now: () => 0, report: options.report } }),
  });
  const shown = () => session.get().slots.map((offer) => offer?.track.id ?? null);
  const written = () => gate.written.at(-1)?.map((offer) => offer.id);
  return { session, gate, shown, written };
};

test("saved offers show from the start, with nothing read or loading", () => {
  const { session, gate, shown } = savedSession(lettered("vwxyz"));
  assert.deepEqual(shown(), ["v", "w", "x", "y", "z"]);
  assert.equal(session.get().loading, false);
  assert.equal(gate.reads, 0);
});

test("with nothing saved, a session waits for its first renewal, shows it and saves it", async () => {
  const { session, shown, written } = savedSession([]);
  assert.equal(session.get().loading, true);
  await session.renew();
  assert.deepEqual(shown(), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(written(), "abcdefghij".split(""));
});

test("a renewal over saved offers changes nothing on screen and saves its own for the next visit", async () => {
  const { session, gate, written } = savedSession(lettered("vwxyz"));
  const before = session.get();
  let notified = 0;
  session.subscribe(() => notified++);
  const held = Promise.withResolvers<void>();
  gate.hold = held;
  const renewing = session.renew();
  assert.equal(session.get().loading, false);
  assert.equal(notified, 0);
  held.resolve();
  await renewing;
  assert.equal(session.get(), before);
  assert.equal(notified, 0);
  assert.deepEqual(written(), "abcdefghij".split(""));
});

test("a renewal after the first one in a visit doesn't change the offers either", async () => {
  const { session, gate, written } = savedSession([]);
  await session.renew();
  const before = session.get().slots;
  gate.library = gate.library.map((song) => ({ ...song, favorite: song.id === "z" }));
  await session.renew();
  assert.equal(session.get().slots, before);
  assert.equal(written()?.[0], "z");
});

test("Add and Dismiss work at once over a renewal under way, which starts over after them", async () => {
  const { session, gate, shown, written } = savedSession(lettered("vwxyz"));
  const held = Promise.withResolvers<void>();
  gate.hold = held;
  const renewing = session.renew();
  const before = session.get().slots;
  const dismissing = session.dismiss(before[1]!.key);
  assert.deepEqual(session.get().pendingSlots, [1]);
  assert.equal(gate.signals[0]?.aborted, true);
  held.resolve();
  await renewing;
  assert.equal(await dismissing, true);
  // Its slot alone filled; what's saved comes from the renewal that followed its refill.
  for (const index of [0, 2, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.equal(shown()[1], "a");
  assert.equal(gate.reads, 3);
  assert.equal(written()?.includes("w"), false);
  assert.equal(written()?.[0], "a");
});

test("an Add or Dismiss takes its song out of what's saved at once", async () => {
  const { session, written } = savedSession(lettered("vwxyz"));
  await session.dismiss(session.get().slots[0]!.key);
  assert.deepEqual(written(), ["w", "x", "y", "z"]);
  await session.accept(session.get().slots[2]!.key);
  assert.deepEqual(written(), ["w", "y", "z"]);
});

test("a failed renewal over saved offers shows nothing, reports it and keeps what's saved", async () => {
  const timings: PlaylistRecommendationTiming[] = [];
  const { session, gate } = savedSession(lettered("vwxyz"), {
    report: (timing) => timings.push(timing),
  });
  const before = session.get();
  gate.fail = true;
  await session.renew();
  assert.equal(session.get(), before);
  assert.equal(session.get().error, null);
  assert.equal(timings[0]?.failed, true);
  assert.deepEqual(gate.written, []);
});

test("a failed renewal with nothing to show offers Try Again", async () => {
  const { session, gate } = savedSession([]);
  gate.fail = true;
  await session.renew();
  assert.equal(session.get().error, "load");
  gate.fail = false;
  await session.renew({ turn: "paint" });
  assert.equal(session.get().error, null);
  assert.equal(session.get().slots[0]?.track.id, "a");
});

test("a read that finds an offer now in the playlist removes it and fills only its slot", async () => {
  const saved = lettered("vwxyz");
  const { session, gate, shown } = savedSession(saved);
  const before = session.get().slots;
  gate.playlist = [...gate.playlist, saved[2]!];
  await session.renew();
  assert.deepEqual(shown(), ["v", "w", "a", "y", "z"]);
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
});

test("a read that finds an offer dismissed removes it and fills only its slot", async () => {
  const saved = lettered("vwxyz");
  const { session, gate, shown } = savedSession(saved);
  gate.feedback = [{ track: saved[0]!, value: -1 }];
  await session.renew();
  assert.deepEqual(shown(), ["a", "w", "x", "y", "z"]);
});

test("a song leaving takes a spare at once when one is saved, moving nothing else", () => {
  const { session, gate, shown, written } = savedSession(lettered("vwxyzqr"));
  const before = session.get().slots;
  session.leave((offer) => offer.id === "x");
  assert.deepEqual(shown(), ["v", "w", "q", "y", "z"]);
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.equal(gate.reads, 0);
  assert.deepEqual(written(), ["v", "w", "y", "z", "q", "r"]);
});

test("a song leaving with no spare holds its slot's placeholder until a refill fills it", async () => {
  const { session, gate, shown } = savedSession(lettered("vwxyz"));
  session.leave((offer) => offer.id === "x");
  assert.deepEqual(session.get().pendingSlots, [2]);
  assert.equal(shown()[2], null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gate.reads, 1);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.deepEqual(shown(), ["v", "w", "a", "y", "z"]);
});

test("a song that isn't showing leaves what's saved without touching the screen", () => {
  const { session, written } = savedSession(lettered("vwxyzq"));
  const before = session.get();
  session.leave((offer) => offer.id === "q");
  assert.equal(session.get(), before);
  assert.deepEqual(written(), ["v", "w", "x", "y", "z"]);
});

test("nothing leaving writes nothing", () => {
  const { session, gate } = savedSession(lettered("vwxyzq"));
  session.leave(() => false);
  assert.deepEqual(gate.written, []);
});

test("an offer whose Add is saving doesn't count as having left", async () => {
  const { session, gate } = savedSession(lettered("vwxyzq"));
  const offer = session.get().slots[0]!;
  const adding = session.accept(offer.key);
  session.leave((other) => other.id === "v");
  assert.deepEqual(session.get().pendingSlots, [0]);
  await adding;
  assert.equal(
    gate.playlist.some((song) => song.id === "v"),
    true,
  );
  assert.equal(session.get().slots[0]?.track.id, "a");
});

test("offline, saved streamed offers stay hidden, and an offline renewal keeps them for later", async () => {
  const saved = [stream("v"), track("w"), stream("x"), track("y")];
  const { session, shown, gate } = savedSession(saved, { online: false });
  assert.deepEqual(shown(), ["w", "y"]);
  await session.renew();
  assert.deepEqual(shown(), ["w", "y"]);
  assert.deepEqual(gate.written, []);
});

test("offline, a streamed spare stays hidden too", () => {
  const { session, shown } = savedSession([track("w"), track("y"), stream("x")], {
    online: false,
  });
  session.leave((offer) => offer.id === "w");
  assert.equal(shown()[0], null);
});

test("offline with only streamed offers saved, the renewal's Library files show", async () => {
  const { session, shown } = savedSession([stream("v"), stream("w")], { online: false });
  assert.deepEqual(shown(), []);
  assert.equal(session.get().loading, true);
  await session.renew();
  assert.equal(session.get().loading, false);
  assert.equal(shown()[0], "a");
});

test("a slot left unfilled by a hidden refill fills on the renewal, the others in place", async () => {
  const { session, shown } = savedSession(lettered("vwxyz"));
  const before = session.get().slots;
  const dismissing = session.dismiss(before[1]!.key);
  session.pause();
  await dismissing;
  assert.deepEqual(session.get().unfilled, [1]);
  session.resume();
  await session.renew();
  assert.deepEqual(shown(), ["v", "a", "x", "y", "z"]);
  assert.deepEqual(session.get().unfilled, []);
  assert.equal(session.get().slots[0], before[0]);
});

test("hiding with a renewal under way leaves one owed for the return", async () => {
  const { session, gate } = savedSession(lettered("vwxyz"));
  assert.equal(session.renewalOwed(), false);
  const held = Promise.withResolvers<void>();
  gate.hold = held;
  const renewing = session.renew();
  assert.equal(session.renewalOwed(), true);
  session.pause();
  held.resolve();
  await renewing;
  assert.equal(session.renewalOwed(), false, "what was asked for has stopped; the visit marks it");
});

test("a renewal held for a tap and then hidden stays owed until a later one runs", async () => {
  const { session, gate } = savedSession(lettered("vwxyz"));
  const saving = Promise.withResolvers<void>();
  gate.hold = saving;
  const renewing = session.renew();
  const dismissing = session.dismiss(session.get().slots[0]!.key);
  session.pause();
  saving.resolve();
  await Promise.all([renewing, dismissing]);
  assert.equal(session.renewalOwed(), true);
  session.resume();
  await session.renew();
  assert.equal(session.renewalOwed(), false);
});
