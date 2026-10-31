import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAYLIST_SAVED_OFFERS,
  parseSavedPlaylistOffers,
  playlistRecommendationSession,
  playlistRecommendations,
  playlistReserveRefillLine,
  type PlaylistRecommendationFeedback,
  type PlaylistRecommendationSessionInput,
  type PlaylistRecommendationTiming,
  type PlaylistRecommendationTrack,
  type PlaylistReserveRefill,
  type PlaylistSlotWait,
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
    readonly yieldTurn?: (kind: "paint" | "free") => Promise<void>;
  } = {},
) => {
  const seed = track("seed");
  const gate = {
    reads: 0,
    ranks: 0,
    online: options.online ?? true,
    fail: false,
    hold: undefined as PromiseWithResolvers<void> | undefined,
    signals: [] as (AbortSignal | undefined)[],
    playlist: [seed],
    library: [seed, ...lettered("abcdefghijklmnopqrstuvwxyz")],
    /** What the radios bring, when it isn't the Library. */
    radio: undefined as readonly PlaylistRecommendationTrack[] | undefined,
    feedback: [] as PlaylistRecommendationFeedback[],
    written: [] as (readonly PlaylistRecommendationTrack[])[],
    /** Each choice as it's written, in order. */
    choices: [] as string[],
    /** Holds the next choice's write. */
    holdSave: undefined as PromiseWithResolvers<void> | undefined,
    saveFails: false,
    waits: [] as PlaylistSlotWait[],
    refills: [] as PlaylistReserveRefill[],
    /** What each ranking was asked to rank. */
    ranked: [] as PlaylistRecommendationSessionInput[],
    clock: 0,
  };
  const save = async (songId: string) => {
    const hold = gate.holdSave;
    gate.holdSave = undefined;
    await hold?.promise;
    if (gate.saveFails) throw new Error("no write");
    gate.choices.push(songId);
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
          pages: [{ id: "song:seed", artists: ["Artist seed"], songs: gate.radio ?? gate.library }],
          graph: null,
          feedback: gate.feedback,
          online: gate.online,
        },
      };
    },
    rank: async (input) => {
      gate.ranks++;
      gate.ranked.push(input);
      return playlistRecommendations(input.playlist, input.sources, PLAYLIST_SAVED_OFFERS);
    },
    dismiss: (offer) => save(offer.track.id),
    accept: async (offer) => {
      await save(offer.track.id);
      gate.playlist = [...gate.playlist, offer.track];
    },
    saved: {
      offers: saved,
      online: () => gate.online,
      write: (offers) => gate.written.push(offers),
    },
    ...(options.yieldTurn === undefined ? {} : { yieldTurn: options.yieldTurn }),
    timed: {
      now: () => gate.clock,
      report: options.report ?? (() => {}),
      slotWait: (wait) => gate.waits.push(wait),
      reserveRefill: (refill) => gate.refills.push(refill),
    },
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
  assert.deepEqual(written(), "abcdefghijklmnopqrst".split(""));
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
  assert.deepEqual(written(), "abcdefghijklmnopqrst".split(""));
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
  const { session, written } = savedSession(lettered("vwxyzqrstuAB"));
  await session.dismiss(session.get().slots[0]!.key);
  assert.deepEqual(written(), "wxyzqrstuAB".split(""));
  await session.accept(session.get().slots[2]!.key);
  assert.deepEqual(written(), "wyzqrstuAB".split(""));
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
  const { session, gate, shown, written } = savedSession(lettered("vwxyzqrstuAB"));
  const before = session.get().slots;
  session.leave((offer) => offer.id === "x");
  assert.deepEqual(shown(), ["v", "w", "q", "y", "z"]);
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.equal(gate.reads, 0);
  assert.deepEqual(written(), "vwyzqrstuAB".split(""));
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

test("a song leaving while reads must wait holds its placeholder, and the renewal fills it", async () => {
  const { session, gate, shown } = savedSession(lettered("vwxyz"));
  const before = session.get().slots;
  session.leave((offer) => offer.id === "x", { read: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gate.reads, 0);
  assert.deepEqual(session.get().pendingSlots, [2]);
  await session.renew();
  assert.equal(gate.reads, 1);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.deepEqual(shown(), ["v", "w", "a", "y", "z"]);
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
});

test("a song leaving while reads must wait still takes a saved spare at once", () => {
  const { session, gate, shown } = savedSession(lettered("vwxyzq"));
  session.leave((offer) => offer.id === "x", { read: false });
  assert.deepEqual(shown(), ["v", "w", "q", "y", "z"]);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.equal(gate.reads, 0);
});

test("every showing song leaving while reads must wait: the renewal is a first visit's", async () => {
  const { session, gate, shown } = savedSession(lettered("vw"));
  session.leave(() => true, { read: false });
  assert.deepEqual(session.get().pendingSlots, [0, 1]);
  await session.renew();
  assert.equal(gate.reads, 1);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.deepEqual(shown(), ["a", "b", "c", "d", "e"]);
});

test("a renewal failing over a slot that waited for it lets the slot go, with no message", async () => {
  const { session, gate, shown } = savedSession(lettered("vwxyz"));
  session.leave((offer) => offer.id === "x", { read: false });
  gate.fail = true;
  await session.renew();
  assert.deepEqual(session.get().pendingSlots, []);
  assert.deepEqual(session.get().unfilled, []);
  assert.equal(session.get().error, null);
  assert.equal(shown()[2], null);
});

test("an Add's refill also fills a slot waiting for reads", async () => {
  const { session, shown } = savedSession(lettered("vwxyz"));
  session.leave((offer) => offer.id === "x", { read: false });
  await session.accept(session.get().slots[0]!.key);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.deepEqual(shown(), ["b", "w", "a", "y", "z"]);
});

test("a session's offers are those showing and those saved, none before anything's saved", async () => {
  const empty = savedSession([]);
  assert.deepEqual(empty.session.offers(), []);
  const { session } = savedSession(lettered("vwxyzq"));
  assert.deepEqual(new Set(session.offers().map((offer) => offer.id)), new Set("vwxyzq".split("")));
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
  assert.equal(session.get().slots[0]?.track.id, "q");
});

test("offline, saved streamed offers stay hidden, and an offline renewal keeps them for later", async () => {
  const saved = [stream("v"), track("w"), stream("x"), track("y")];
  const { session, shown, gate } = savedSession(saved, { online: false });
  assert.deepEqual(shown(), ["w", "y"]);
  await session.renew();
  assert.deepEqual(shown(), ["w", "y", "a", "b", "c"], "free slots take Library files");
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

test("a first load cancelled by hiding still reads as loading, for the renewal it's owed", async () => {
  const { session, gate } = savedSession([]);
  const held = Promise.withResolvers<void>();
  gate.hold = held;
  const renewing = session.renew();
  session.pause();
  held.resolve();
  await renewing;
  session.resume();
  assert.equal(session.get().loading, true);
  assert.deepEqual(session.get().slots, []);
  await session.renew();
  assert.equal(session.get().loading, false);
  assert.equal(session.get().slots[0]?.track.id, "a");
});

test("a first load cancelled by its asker still reads as loading", async () => {
  const { session, gate } = savedSession([]);
  const held = Promise.withResolvers<void>();
  gate.hold = held;
  const asker = new AbortController();
  const renewing = session.renew({ signal: asker.signal });
  asker.abort();
  held.resolve();
  await renewing;
  assert.equal(session.get().loading, true);
});

test("a cancelled Try Again goes back to loading, not to an empty section", async () => {
  const { session, gate } = savedSession([]);
  gate.fail = true;
  await session.renew();
  assert.equal(session.get().error, "load");
  gate.fail = false;
  const held = Promise.withResolvers<void>();
  gate.hold = held;
  const retrying = session.renew({ turn: "paint" });
  session.pause();
  held.resolve();
  await retrying;
  assert.equal(session.get().loading, true);
  assert.equal(session.get().error, null);
});

test("what changed while paused is heard on resuming, once", () => {
  const { session } = savedSession(lettered("vwxyzqr"));
  let notified = 0;
  session.subscribe(() => notified++);
  session.pause();
  session.leave((offer) => offer.id === "x");
  session.leave((offer) => offer.id === "y");
  assert.equal(notified, 0);
  session.resume();
  assert.equal(notified, 1);
  session.pause();
  session.resume();
  assert.equal(notified, 1, "nothing changed this time");
});

test("a short section grows from a renewal, the offers showing staying as they are", async () => {
  const { session, shown } = savedSession(lettered("vw"));
  const before = session.get().slots;
  await session.renew();
  assert.deepEqual(shown(), ["v", "w", "a", "b", "c"]);
  assert.equal(session.get().slots[0], before[0]);
  assert.equal(session.get().slots[1], before[1]);
});

test("a slot left empty with nothing to replace it fills on a later renewal", async () => {
  const { session, gate, shown } = savedSession(lettered("vwxyz"));
  const library = gate.library;
  gate.library = [library[0]!];
  await session.dismiss(session.get().slots[1]!.key);
  assert.deepEqual(shown(), ["v", null, "x", "y", "z"]);
  assert.deepEqual(session.get().unfilled, []);
  const before = session.get().slots;
  gate.library = library;
  await session.renew();
  assert.deepEqual(shown(), ["v", "a", "x", "y", "z"]);
  for (const index of [0, 2, 3, 4]) assert.equal(session.get().slots[index], before[index]);
});

test("filling free slots keeps to the artist cap with the offers showing", async () => {
  const saved = [
    { ...track("v"), artists: ["Artist a"] },
    { ...track("w"), artists: ["Artist a"] },
  ];
  const { session, gate, shown } = savedSession(saved);
  gate.library = [gate.library[0]!, ...saved, ...lettered("abcd")];
  await session.renew();
  assert.deepEqual(shown(), ["v", "w", "b", "c", "d"]);
});

test("a renewal with nothing to fill a short section's free slots publishes nothing", async () => {
  const { session, gate } = savedSession(lettered("vw"));
  gate.library = [gate.library[0]!, ...lettered("vw")];
  const before = session.get();
  let notified = 0;
  session.subscribe(() => notified++);
  await session.renew();
  assert.equal(session.get(), before);
  assert.equal(notified, 0);
});

test("a renewal refreshes a showing offer's tags in place, on its slot and key, ranked or not", async () => {
  const { session, gate, shown } = savedSession(lettered("vwxyz"));
  const before = session.get().slots;
  gate.library = gate.library.map((song) =>
    song.id === "x" ? { ...song, title: "Fixed", artworkUrl: "fixed.jpg" } : song,
  );
  let notified = 0;
  session.subscribe(() => notified++);
  await session.renew();
  const after = session.get().slots;
  assert.deepEqual(shown(), ["v", "w", "x", "y", "z"]);
  assert.equal(after[2]?.key, before[2]?.key);
  assert.equal(after[2]?.track.title, "Fixed");
  assert.equal(after[2]?.track.artworkUrl, "fixed.jpg");
  for (const index of [0, 1, 3, 4]) assert.equal(after[index], before[index]);
  assert.equal(notified, 1);
});

test("a streamed offer's tags refresh from the ranking", async () => {
  const offer = { ...stream("v"), id: "yt:v" };
  const { session, gate } = savedSession([offer]);
  const before = session.get().slots[0];
  gate.radio = [{ ...offer, title: "Fixed" }];
  await session.renew();
  assert.equal(session.get().slots[0]?.key, before?.key);
  assert.equal(session.get().slots[0]?.track.title, "Fixed");
});

test("an Add with a spare fills its slot from it, with no read or ranking, moving nothing else", async () => {
  const { session, gate, shown, written } = savedSession(lettered("vwxyzqrstuAB"));
  const before = session.get().slots;
  assert.equal(await session.accept(before[1]!.key), true);
  assert.deepEqual(shown(), ["v", "q", "x", "y", "z"]);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.deepEqual(session.get().pending, []);
  for (const index of [0, 2, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.equal(gate.reads, 0);
  assert.equal(gate.ranks, 0);
  assert.deepEqual(gate.choices, ["w"]);
  assert.deepEqual(written(), "vxyzqrstuAB".split(""));
});

test("a Dismiss with a spare does too, and its wait says the offer came from a spare", async () => {
  const { session, gate, shown } = savedSession(lettered("vwxyzqrstuAB"));
  const dismissing = session.dismiss(session.get().slots[4]!.key);
  gate.clock = 120;
  await dismissing;
  assert.deepEqual(shown(), ["v", "w", "x", "y", "q"]);
  assert.equal(gate.reads, 0);
  assert.equal(gate.ranks, 0);
  assert.deepEqual(gate.waits, [{ action: "dismiss", ms: 120, outcome: "offer", from: "spare" }]);
});

test("a spare's wait lasts until the frame showing it", async () => {
  const frames: (() => void)[] = [];
  const { session, gate, shown } = savedSession(lettered("vwxyzq"), {
    yieldTurn: (kind) =>
      kind === "paint" ? new Promise((resolve) => frames.push(resolve)) : Promise.resolve(),
  });
  const adding = session.accept(session.get().slots[0]!.key);
  // The tap's own placeholder frame goes before the write.
  frames.shift()!();
  await adding;
  assert.equal(shown()[0], "q");
  assert.deepEqual(gate.waits, []);
  gate.clock = 40;
  frames.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(gate.waits, [{ action: "add", ms: 40, outcome: "offer", from: "spare" }]);
});

test("the slot holds its placeholder until the choice is saved, then takes the spare", async () => {
  const { session, gate, shown } = savedSession(lettered("vwxyzq"));
  const held = Promise.withResolvers<void>();
  gate.holdSave = held;
  const adding = session.accept(session.get().slots[2]!.key);
  assert.deepEqual(session.get().pendingSlots, [2]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shown()[2], "x");
  held.resolve();
  await adding;
  assert.equal(shown()[2], "q");
  assert.deepEqual(session.get().pendingSlots, []);
});

test("a failed save keeps its offer and leaves the spare for the retry", async () => {
  const { session, gate, shown } = savedSession(lettered("vwxyzqrstuA"));
  gate.saveFails = true;
  const offer = session.get().slots[0]!;
  assert.equal(await session.dismiss(offer.key), false);
  assert.deepEqual(shown(), ["v", "w", "x", "y", "z"]);
  assert.equal(session.get().error, "save");
  assert.equal(gate.waits[0]?.outcome, "save failed");
  gate.saveFails = false;
  assert.equal(await session.dismiss(offer.key), true);
  assert.deepEqual(shown(), ["q", "w", "x", "y", "z"]);
  assert.equal(gate.reads, 0);
});

test("a spare keeps to the artist cap with the offers showing, the tapped one no longer counted", async () => {
  const capped = (id: string) => ({ ...track(id), artists: ["Artist a"] });
  const saved = [
    capped("v"),
    capped("w"),
    track("x"),
    track("y"),
    track("z"),
    capped("q"),
    track("r"),
  ];
  const { session, shown } = savedSession(saved);
  await session.dismiss(session.get().slots[2]!.key);
  assert.deepEqual(shown(), ["v", "w", "r", "y", "z"], "q would be a third by Artist a");
  await session.dismiss(session.get().slots[0]!.key);
  assert.deepEqual(shown(), ["q", "w", "r", "y", "z"], "v has gone, so q fits now");
});

test("a spare the playlist holds, or has dismissed, is never offered", async () => {
  const saved = lettered("vwxyzqrs");
  const { session, gate, shown } = savedSession(saved);
  // A song added elsewhere: the playlist's entries say so.
  session.leave((offer) => offer.id === "q");
  // Dismissed on another phone: a renewal's read says so, and it ranks nothing new here.
  gate.feedback = [{ track: saved[6]!, value: -1 }];
  gate.online = false;
  await session.renew();
  gate.online = true;
  await session.dismiss(session.get().slots[0]!.key);
  assert.deepEqual(shown(), ["s", "w", "x", "y", "z"]);
  assert.equal(
    session.offers().some((offer) => offer.id === "q" || offer.id === "r"),
    false,
  );
});

test("another recording of a song just added doesn't step in as its spare", async () => {
  const added = { ...track("v"), album: "Album", title: "Song", artists: ["Band"] };
  const other = { ...track("q"), album: "Album", title: "Song", artists: ["Band"] };
  const { session, shown } = savedSession([added, ...lettered("wxyz"), other, track("r")]);
  await session.accept(session.get().slots[0]!.key);
  assert.deepEqual(shown(), ["r", "w", "x", "y", "z"]);
});

test("offline, a streamed spare stays hidden: a Library spare goes first, and without one a refill", async () => {
  const saved = [...lettered("vwxyz"), stream("q"), track("r")];
  const { session, gate, shown, written } = savedSession(saved, { online: false });
  await session.dismiss(session.get().slots[0]!.key);
  assert.equal(shown()[0], "r");
  assert.deepEqual(
    gate.waits.map((wait) => wait.from),
    ["spare"],
  );
  // r was the last spare that can show: the reserve refills, and the next slot takes from that.
  assert.equal(gate.reads, 1);
  await new Promise((resolve) => setImmediate(resolve));
  await session.dismiss(session.get().slots[1]!.key);
  assert.equal(shown()[1], "a");
  assert.equal(gate.reads, 1);
  assert.equal(
    written()?.includes("q"),
    true,
    "the streamed spare stays saved for when the phone is back online",
  );
});

test("quick taps each fill their own slot with their own spare, and nothing is written twice", async () => {
  const { session, gate, shown } = savedSession(lettered("vwxyzqrstuABCD"));
  const held = Promise.withResolvers<void>();
  gate.holdSave = held;
  const [first, second, third] = session.get().slots;
  const taps = [
    session.accept(first!.key),
    session.dismiss(second!.key),
    session.accept(third!.key),
  ];
  assert.equal(await session.accept(first!.key), false, "a repeated tap is ignored");
  assert.deepEqual(session.get().pendingSlots, [0, 1, 2]);
  held.resolve();
  await Promise.all(taps);
  assert.deepEqual(shown(), ["q", "r", "s", "y", "z"]);
  assert.deepEqual(gate.choices, ["v", "w", "x"], "written once each, in tap order");
  assert.equal(gate.reads, 0);
  assert.deepEqual(
    gate.waits.map((wait) => wait.from),
    ["spare", "spare", "spare"],
  );
});

test("with no spare left, the slot holds its placeholder and fills from the next ranking", async () => {
  const { session, gate, shown } = savedSession(lettered("vwxyz"));
  const held = Promise.withResolvers<void>();
  gate.hold = held;
  const dismissing = session.dismiss(session.get().slots[1]!.key);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(session.get().pendingSlots, [1]);
  assert.equal(shown()[1], null);
  held.resolve();
  await dismissing;
  assert.equal(shown()[1], "a");
  assert.deepEqual(session.get().pendingSlots, []);
  assert.equal(gate.reads, 1);
  assert.deepEqual(
    gate.waits.map((wait) => wait.from),
    ["ranking"],
  );
});

test("a slot whose refill failed goes to the refill while the tapped slot takes the only spare", async () => {
  const capped = (id: string) => ({ ...track(id), artists: ["Band"] });
  const saved = [track("v"), track("w"), capped("x"), capped("y"), track("z"), capped("q")];
  const { session, gate, shown } = savedSession(saved);
  gate.fail = true;
  await session.dismiss(session.get().slots[0]!.key);
  assert.deepEqual(session.get().unfilled, [0], "q would be a third by Band");
  gate.fail = false;
  await session.dismiss(session.get().slots[2]!.key);
  assert.deepEqual(shown(), ["a", "w", "q", "y", "z"]);
  assert.deepEqual(session.get().unfilled, []);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.equal(gate.reads, 2);
});

test("a tap over a renewal under way resolves with its spare, and the renewal runs again behind", async () => {
  const { session, gate, shown, written } = savedSession(lettered("vwxyzq"));
  const held = Promise.withResolvers<void>();
  gate.hold = held;
  const renewing = session.renew();
  const dismissing = session.dismiss(session.get().slots[0]!.key);
  assert.equal(gate.signals[0]?.aborted, true);
  // The renewal that follows holds its read, and the tap doesn't wait for it.
  const again = Promise.withResolvers<void>();
  gate.hold = again;
  assert.equal(await dismissing, true);
  assert.deepEqual(shown(), ["q", "w", "x", "y", "z"]);
  assert.equal(session.renewalOwed(), true);
  held.resolve();
  again.resolve();
  await renewing;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.renewalOwed(), false);
  assert.equal(written()?.[0], "a");
  assert.deepEqual(shown(), ["q", "w", "x", "y", "z"]);
});

test("hiding during a save still fills from a spare, with no read, heard on the return", async () => {
  const { session, gate, shown } = savedSession(lettered("vwxyzq"));
  let notified = 0;
  const held = Promise.withResolvers<void>();
  gate.holdSave = held;
  const dismissing = session.dismiss(session.get().slots[0]!.key);
  session.subscribe(() => notified++);
  session.pause();
  held.resolve();
  await dismissing;
  assert.equal(shown()[0], "q");
  assert.deepEqual(session.get().unfilled, []);
  assert.equal(gate.reads, 0);
  assert.equal(notified, 0);
  session.resume();
  assert.equal(notified, 1);
});

test("closing the playlist during a save writes the choice and says its wait was cancelled", async () => {
  const { session, gate, written } = savedSession(lettered("vwxyzq"));
  const held = Promise.withResolvers<void>();
  gate.holdSave = held;
  const dismissing = session.dismiss(session.get().slots[0]!.key);
  session.dispose();
  held.resolve();
  await dismissing;
  assert.deepEqual(gate.choices, ["v"]);
  assert.equal(written()?.includes("v"), false);
  assert.equal(gate.reads, 0);
  assert.deepEqual(
    gate.waits.map((wait) => wait.outcome),
    ["cancelled"],
  );
});

test("offers saved before the reserve, ten at most, load and serve as spares", async () => {
  const text = JSON.stringify(lettered("vwxyzqrstu").map((offer) => ({ track: offer })));
  const offers = parseSavedPlaylistOffers(text).map((offer) => offer.track);
  const { session, gate, shown } = savedSession(offers);
  assert.deepEqual(shown(), ["v", "w", "x", "y", "z"]);
  await session.dismiss(session.get().slots[0]!.key);
  assert.deepEqual(shown(), ["q", "w", "x", "y", "z"]);
  assert.equal(gate.waits[0]?.from, "spare");
});

/** Five showing and the [spares]. */
const withSpares = (spares: string) => lettered(`vwxyz${spares}`);

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("a tap leaving 5 spares reads nothing; the one leaving 4 refills behind the screen", async () => {
  const { session, gate, shown } = savedSession(withSpares("qrstuA"));
  await session.dismiss(session.get().slots[0]!.key);
  assert.equal(gate.reads, 0, "5 spares left");
  const hold = Promise.withResolvers<void>();
  gate.hold = hold;
  assert.equal(await session.dismiss(session.get().slots[1]!.key), true, "the tap doesn't wait");
  assert.deepEqual(shown(), ["q", "r", "x", "y", "z"]);
  assert.equal(gate.reads, 1, "4 spares left");
  assert.equal(gate.ranks, 0);
  hold.resolve();
  await nextTurn();
  assert.equal(gate.ranks, 1);
});

test("a refill adds to the spares it keeps, up to 20 offers, and changes nothing showing", async () => {
  const { session, gate, written } = savedSession(withSpares("qrstu"));
  const hold = Promise.withResolvers<void>();
  gate.hold = hold;
  await session.dismiss(session.get().slots[0]!.key);
  const before = session.get();
  let notified = 0;
  session.subscribe(() => notified++);
  hold.resolve();
  await nextTurn();
  assert.equal(session.get(), before);
  assert.equal(notified, 0);
  assert.deepEqual(written(), "wxyzqrstuabcdefghijk".split(""));
  assert.deepEqual(gate.refills, [{ ms: 0, added: 11, spares: 15, failed: false }]);
});

test("a tap during a refill takes a spare left, without waiting or a second refill", async () => {
  const { session, gate, shown } = savedSession(withSpares("qrstu"));
  const hold = Promise.withResolvers<void>();
  gate.hold = hold;
  await session.dismiss(session.get().slots[0]!.key);
  assert.equal(gate.reads, 1);
  assert.equal(await session.dismiss(session.get().slots[1]!.key), true);
  assert.deepEqual(shown(), ["q", "r", "x", "y", "z"]);
  assert.equal(gate.reads, 1, "one refill at a time");
  hold.resolve();
  await nextTurn();
  assert.equal(gate.reads, 1);
});

test("new spares reflect the Adds and Dismisses saved before the refill ranks", async () => {
  const { session, gate, written } = savedSession(withSpares("qrstu"));
  const hold = Promise.withResolvers<void>();
  gate.hold = hold;
  await session.accept(session.get().slots[0]!.key);
  // Taken while the refill reads: its ranking comes after this choice.
  await session.dismiss(session.get().slots[1]!.key);
  hold.resolve();
  await nextTurn();
  const input = gate.ranked.at(-1)!;
  assert.deepEqual(
    input.playlist.map((offer) => offer.id),
    ["seed", "v"],
  );
  const excluded = input.sources.exclude?.map((offer) => offer.id) ?? [];
  for (const id of ["v", "w"]) {
    assert.equal(excluded.includes(id), true, id);
    assert.equal(written()?.includes(id), false, id);
  }
});

test("a slot waiting on its placeholder takes the refill's new spares with no second read", async () => {
  const capped = (id: string) => ({ ...track(id), artists: ["Band"] });
  const saved = [
    capped("v"),
    capped("w"),
    track("x"),
    track("y"),
    track("z"),
    track("q"),
    ...["B1", "B2", "B3", "B4"].map(capped),
  ];
  const { session, gate, shown } = savedSession(saved);
  const hold = Promise.withResolvers<void>();
  gate.hold = hold;
  // q takes x's slot and leaves 4 spares, all by Band, whose cap is full.
  await session.dismiss(session.get().slots[2]!.key);
  assert.equal(gate.reads, 1);
  const waiting = session.dismiss(session.get().slots[3]!.key);
  await nextTurn();
  assert.deepEqual(session.get().pendingSlots, [3]);
  const before = session.get().slots;
  hold.resolve();
  await waiting;
  assert.deepEqual(shown(), ["v", "w", "q", "a", "z"]);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.equal(gate.reads, 1);
  for (const index of [0, 1, 2, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.deepEqual(
    gate.waits.map((wait) => wait.from),
    ["spare", "spare"],
  );
});

test("a slot refilled from a ranking keeps what didn't fill it as spares", async () => {
  const { session, gate, shown, written } = savedSession(lettered("vwxyz"));
  await session.dismiss(session.get().slots[0]!.key);
  assert.equal(shown()[0], "a");
  assert.equal(gate.reads, 1);
  assert.deepEqual(written(), "wxyzabcdefghijklmnop".split(""));
  await session.dismiss(session.get().slots[1]!.key);
  assert.equal(shown()[1], "b");
  assert.equal(gate.reads, 1, "the spares just kept fill it");
});

test("a reserve the ranking leaves short doesn't read again on that tap, or while spares are left", async () => {
  const { session, gate, shown, written } = savedSession(withSpares("qrs"));
  // The radios bring only one song more: the reserve stays short of 5 spares.
  gate.library = [gate.library[0]!, track("a")];
  await session.dismiss(session.get().slots[0]!.key);
  await nextTurn();
  assert.equal(gate.reads, 1, "one tap, one refill");
  assert.deepEqual(written(), "wxyzqrsa".split(""));
  await session.dismiss(session.get().slots[1]!.key);
  await session.dismiss(session.get().slots[2]!.key);
  await nextTurn();
  assert.equal(gate.reads, 1, "a spare is left");
  assert.deepEqual(shown(), ["q", "r", "s", "y", "z"]);
});

test("a short reserve refills again when its last spare goes, and with 5 spares back the rule is too", async () => {
  const { session, gate } = savedSession(withSpares("qr"));
  gate.radio = [];
  await session.dismiss(session.get().slots[0]!.key);
  await nextTurn();
  assert.equal(gate.reads, 1);
  await session.dismiss(session.get().slots[1]!.key);
  await nextTurn();
  assert.equal(gate.reads, 2, "the last spare taken");
  // A renewal saves a to k: 11 spares, none of them showing.
  gate.radio = lettered("abcdefghijk");
  await session.renew();
  assert.equal(gate.reads, 3);
  for (let taps = 0; taps < 6; taps++) await session.dismiss(session.get().slots[0]!.key);
  await nextTurn();
  assert.equal(gate.reads, 3, "5 spares left");
  await session.dismiss(session.get().slots[0]!.key);
  await nextTurn();
  assert.equal(gate.reads, 4, "4 spares left");
});

test("a failed refill shows nothing, is logged, and the next low point tries again", async () => {
  const { session, gate } = savedSession(withSpares("qrstu"));
  gate.fail = true;
  const hold = Promise.withResolvers<void>();
  gate.hold = hold;
  await session.dismiss(session.get().slots[0]!.key);
  const before = session.get();
  gate.clock = 900;
  hold.resolve();
  await nextTurn();
  assert.equal(session.get(), before);
  assert.equal(session.get().error, null);
  assert.deepEqual(gate.refills, [{ ms: 900, added: 0, spares: 4, failed: true }]);
  gate.fail = false;
  await session.dismiss(session.get().slots[1]!.key);
  await nextTurn();
  assert.equal(gate.reads, 2);
  assert.equal(gate.refills.at(-1)?.failed, false);
});

for (const leaving of ["pause", "dispose"] as const) {
  test(`leaving the playlist cancels a refill, saving and logging nothing: ${leaving}`, async () => {
    const { session, gate } = savedSession(withSpares("qrstu"));
    const hold = Promise.withResolvers<void>();
    gate.hold = hold;
    await session.dismiss(session.get().slots[0]!.key);
    const writes = gate.written.length;
    session[leaving]();
    assert.equal(gate.signals.at(-1)?.aborted, true);
    gate.fail = true;
    hold.resolve();
    await nextTurn();
    assert.equal(gate.ranks, 0);
    assert.equal(gate.written.length, writes);
    assert.deepEqual(gate.refills, []);
    assert.equal(session.get().error, null);
  });
}

test("hidden, a tap whose save ends takes its spare but starts no refill", async () => {
  const { session, gate, shown } = savedSession(withSpares("qrstu"));
  const held = Promise.withResolvers<void>();
  gate.holdSave = held;
  const dismissing = session.dismiss(session.get().slots[0]!.key);
  session.pause();
  held.resolve();
  await dismissing;
  assert.equal(shown()[0], "q");
  assert.equal(gate.reads, 0);
});

test("a renewal owed goes instead of a refill, and one asked for during a refill runs after it", async () => {
  const first = savedSession(withSpares("qrstu"));
  const renewing = first.session.renew();
  await first.session.dismiss(first.session.get().slots[0]!.key);
  await renewing;
  await nextTurn();
  assert.equal(first.gate.reads, 2, "the renewal the tap stopped, then its rerun");
  assert.deepEqual(first.gate.refills, []);

  const second = savedSession(withSpares("qrstu"));
  const hold = Promise.withResolvers<void>();
  second.gate.hold = hold;
  await second.session.dismiss(second.session.get().slots[0]!.key);
  await second.session.renew();
  assert.equal(second.gate.reads, 1, "it waits for the refill");
  hold.resolve();
  await nextTurn();
  assert.equal(second.gate.reads, 2);
});

test("an offer leaving takes a spare and, with reads allowed, is a low point too", async () => {
  const reading = savedSession(withSpares("qrstu"));
  reading.session.leave((offer) => offer.id === "v");
  await nextTurn();
  assert.equal(reading.gate.reads, 1);

  const settling = savedSession(withSpares("qrstu"));
  settling.session.leave((offer) => offer.id === "v", { read: false });
  await nextTurn();
  assert.equal(settling.shown()[0], "q");
  assert.equal(settling.gate.reads, 0);
});

test("offline, hidden streamed spares don't count towards the 5", async () => {
  const saved = [...withSpares("qrstu"), ...["A", "B", "C"].map(stream)];
  const { session, gate } = savedSession(saved, { online: false });
  await session.dismiss(session.get().slots[0]!.key);
  await nextTurn();
  assert.equal(gate.reads, 1);
});

test("a session with nowhere to keep spares starts no refill of its own", async () => {
  const seed = track("seed");
  const library = [seed, ...lettered("abcdefghijklmnop")];
  let reads = 0;
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      reads++;
      return {
        playlist: [seed],
        sources: {
          library,
          pages: [{ id: "song:seed", artists: ["Artist seed"], songs: library }],
          graph: null,
        },
      };
    },
    dismiss: async () => {},
  });
  await session.renew();
  await session.dismiss(session.get().slots[0]!.key);
  await session.dismiss(session.get().slots[1]!.key);
  await nextTurn();
  assert.equal(reads, 3, "the renewal and each slot's own");
});

test("a refill reads as one log line", () => {
  assert.equal(
    playlistReserveRefillLine({ ms: 2410.4, added: 11, spares: 15, failed: false }),
    "Playlist reserve refill: 11 new spares, 15 ready after 2410 ms",
  );
  assert.equal(
    playlistReserveRefillLine({ ms: 900, added: 1, spares: 1, failed: false }),
    "Playlist reserve refill: 1 new spare, 1 ready after 900 ms",
  );
  assert.equal(
    playlistReserveRefillLine({ ms: 900, added: 0, spares: 4, failed: true }),
    "Playlist reserve refill failed after 900 ms",
  );
});
