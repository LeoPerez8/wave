import assert from "node:assert/strict";
import { test } from "node:test";
import {
  playlistRecommendationSession,
  playlistSuggestionsLine,
  type PlaylistRecommendationTiming,
  type PlaylistRecommendationFeedback,
  type PlaylistRecommendationSessionInput,
  type PlaylistRecommendationTrack,
} from "./index.ts";

const track = (id: string): PlaylistRecommendationTrack => ({
  id,
  source: "library",
  videoId: "",
  title: id,
  artists: ["Radiohead"],
  album: "OK Computer",
  albumId: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
  genre: "Rock",
});

test("the next refill reads newly favorited or downloaded candidates ahead of ordinary matches", async () => {
  const seed = track("seed");
  let library = [seed, ..."abcdefgh".split("").map(track)];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({
      playlist: [seed],
      sources: { library, catalog: [], graph: null, now: 0 },
    }),
    dismiss: async () => {},
  });
  await session.renew();
  library = library.map((song) => ({ ...song, favorite: song.id === "h" }));
  assert.equal(await session.dismiss(session.get().slots[2]!.key), true);
  assert.equal(session.get().slots[2]?.track.id, "h");
  library = library.map((song) => ({ ...song, favorite: false, downloaded: song.id === "g" }));
  assert.equal(await session.dismiss(session.get().slots[3]!.key), true);
  assert.equal(session.get().slots[3]?.track.id, "g");
});

test("full renewal includes newly favorited and downloaded matches even when all five slots are occupied", async () => {
  const seed = track("seed");
  let library = [seed, ..."abcdefgh".split("").map(track)];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({
      playlist: [seed],
      sources: { library, catalog: [], graph: null, now: 0 },
    }),
    dismiss: async () => {},
  });
  const selectedIds = () =>
    session
      .get()
      .slots.flatMap((offer) => offer?.track.id ?? [])
      .toSorted();
  await session.renew();
  assert.deepEqual(selectedIds(), ["a", "b", "c", "d", "e"]);
  library = library.map((song) => ({ ...song, favorite: song.id === "h" }));
  await session.renew();
  assert.deepEqual(selectedIds(), ["a", "b", "c", "d", "h"]);
  library = library.map((song) => ({ ...song, favorite: false, downloaded: song.id === "g" }));
  await session.renew();
  assert.deepEqual(selectedIds(), ["a", "b", "c", "d", "g"]);
});

test("unchanged playlist membership does not keep removed Library candidates offered", async () => {
  const seed = track("seed");
  let library = [seed, ..."abcde".split("").map(track)];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({
      playlist: [seed],
      sources: { library, catalog: [], graph: null, now: 0 },
    }),
    dismiss: async () => {},
  });
  await session.renew();
  assert.equal(session.get().slots.filter((offer) => offer !== null).length, 5);
  library = [seed];
  await session.renew();
  assert.deepEqual(
    session.get().slots.flatMap((offer) => offer ?? []),
    [],
  );
  assert.equal(session.get().error, null);
});

for (const timing of ["before snapshot", "after snapshot"]) {
  test(`an external playlist addition during a full read removes the newly present offer: ${timing}`, async () => {
    const seed = track("seed");
    const library = [seed, ..."abcdefgh".split("").map(track)];
    let playlist = [seed];
    let id = 0;
    let pause = true;
    let release!: () => void;
    const session = playlistRecommendationSession({
      newId: () => String(++id),
      read: async () => {
        const snapshot = timing === "after snapshot" ? playlist : undefined;
        if (pause) {
          pause = false;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return {
          playlist: snapshot ?? playlist,
          sources: { library, catalog: [], graph: null, now: 0 },
        };
      },
      dismiss: async () => {},
    });
    const reading = session.renew();
    playlist = [...playlist, library[1]!];
    await session.renew();
    release();
    await reading;
    assert.deepEqual(
      session
        .get()
        .slots.flatMap((offer) => offer?.track.id ?? [])
        .toSorted(),
      ["b", "c", "d", "e", "f"],
    );
    assert.equal(session.get().loading, false);
  });
}

test("acceptance preserves the four held offers and keys; a later external edit renews priority", async () => {
  const seed = track("seed");
  let playlist = [seed];
  let library = [seed, ..."abcdefgh".split("").map(track)];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({ playlist, sources: { library, catalog: [], graph: null, now: 0 } }),
    dismiss: async () => {},
    accept: async (offer) => {
      playlist = [...playlist, offer.track];
    },
  });
  await session.renew();
  const before = session.get().slots;
  library = library.map((song) => ({ ...song, favorite: song.id === "g" || song.id === "h" }));
  assert.equal(await session.accept(before[2]!.key), true);
  assert.equal(session.get().slots[2]?.track.id, "g");
  // The adapter announces its own Add synchronously without requesting a full renewal.
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  playlist = [...playlist, track("external")];
  await session.renew();
  assert.deepEqual(
    session
      .get()
      .slots.flatMap((offer) => offer?.track.id ?? [])
      .toSorted(),
    ["a", "b", "d", "g", "h"],
  );
});

test("an external addition of a held offer is not acknowledged as Add's own notification", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcdefgh".split("").map(track)];
  let playlist = [seed];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({ playlist, sources: { library, catalog: [], graph: null, now: 0 } }),
    dismiss: async () => {},
    accept: async (offer) => {
      // Another writer adds a held offer before Add's refill snapshots membership.
      playlist = [...playlist, offer.track, library[1]!];
    },
  });
  await session.renew();
  assert.equal(await session.accept(session.get().slots[2]!.key), true);
  // The external writer's notification arrives after that same snapshot was read.
  await session.renew();
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id),
    ["g", "b", "f", "d", "e"],
  );
});

test("initial read failure stays retryable and an empty or exhausted playlist has no invented offers", async () => {
  let fail = true;
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      if (fail) throw new Error("database unavailable");
      return {
        playlist: [],
        sources: { library: [track("unused")], catalog: [], graph: null, now: 0 },
      };
    },
    dismiss: async () => {},
  });
  await session.renew();
  assert.equal(session.get().loading, false);
  assert.equal(session.get().error, "load");
  assert.equal(await session.dismiss("missing"), false);
  fail = false;
  await session.renew();
  assert.equal(session.get().error, null);
  assert.equal(session.get().slots.filter((x) => x !== null).length, 0);
});

test("favorite and download source changes during Add renew priority after the single-slot refill", async () => {
  const seed = track("seed");
  let playlist = [seed];
  let library = [seed, ..."abcdefgh".split("").map(track)];
  let id = 0;
  let release!: () => void;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({ playlist, sources: { library, catalog: [], graph: null, now: 0 } }),
    dismiss: async () => {},
    accept: async (offer) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      playlist = [...playlist, offer.track];
    },
  });
  await session.renew();
  const adding = session.accept(session.get().slots[2]!.key);
  library = library.map((song) => ({
    ...song,
    favorite: song.id === "g",
    downloaded: song.id === "h",
  }));
  // A source invalidation is independent of Add's membership acknowledgement.
  await session.renew();
  release();
  assert.equal(await adding, true);
  assert.deepEqual(
    session
      .get()
      .slots.flatMap((offer) => offer?.track.id ?? [])
      .toSorted(),
    ["a", "b", "d", "g", "h"],
  );
});

test("acceptance records only successful additions and uses updated contents for one replacement", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcdefgh".split("").map(track)];
  let playlist = [seed];
  let id = 0;
  let fail = true;
  let release!: () => void;
  const accepted: string[] = [];
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({ playlist, sources: { library, catalog: [], graph: null, now: 0 } }),
    dismiss: async () => {},
    accept: async (offer) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (fail) throw new Error("disk full");
      playlist = [...playlist, offer.track, track("f")]; // another writer added f meanwhile
      accepted.push(offer.track.id);
    },
  });
  await session.renew();
  const before = session.get().slots;
  const adding = session.accept(before[2]!.key);
  assert.equal(await session.accept(before[2]!.key), false);
  assert.equal(await session.dismiss(before[0]!.key), false);
  release();
  assert.equal(await adding, false);
  assert.deepEqual(accepted, []);
  assert.deepEqual(session.get().slots, before);
  fail = false;
  const retry = session.accept(before[2]!.key);
  release();
  assert.equal(await retry, true);
  assert.deepEqual(accepted, ["c"]);
  assert.equal(session.get().slots[2]?.track.id, "g");
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.equal(await session.accept(before[2]!.key), false);
});

test("dismissal saves once before replacing only its slot; failed saves keep the row and allow retry", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcdefg".split("").map(track)];
  let release!: () => void;
  let fail = true;
  let saves = 0;
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({
      playlist: [seed],
      sources: { library, catalog: [], graph: null, now: 0 },
    }),
    dismiss: async () => {
      saves++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (fail) throw new Error("disk full");
    },
  });
  await session.renew();
  const before = session.get().slots;
  const offer = before[2]!;
  const saving = session.dismiss(offer.key);
  assert.equal(await session.dismiss(offer.key), false);
  release();
  assert.equal(await saving, false);
  assert.deepEqual(session.get().slots, before);
  assert.equal(session.get().error, "save");
  fail = false;
  const retry = session.dismiss(offer.key);
  release();
  assert.equal(await retry, true);
  assert.equal(saves, 2);
  assert.equal(session.get().slots[2]?.track.id, "f");
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  await session.renew();
  assert.equal(
    session.get().slots.some((x) => x?.track.id === offer.track.id),
    false,
  );
  assert.equal(await session.dismiss(offer.key), false);
});

test("a successful dismissal survives refill failure; retry fills its hole without moving the other offers", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcdefg".split("").map(track)];
  let unavailable = false;
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      if (unavailable) throw new Error("read failed");
      return { playlist: [seed], sources: { library, catalog: [], graph: null, now: 0 } };
    },
    dismiss: async () => {
      unavailable = true;
    },
  });
  await session.renew();
  const before = session.get().slots;
  assert.equal(await session.dismiss(before[2]!.key), true);
  assert.equal(session.get().slots[2], null);
  assert.equal(session.get().error, "refill");
  unavailable = false;
  await session.renew({ refillOnly: true });
  assert.equal(session.get().slots[2]?.track.id, "f");
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
});

test("refill recovery preserves held offer objects and keys when saved dismissal feedback changes ranking", async () => {
  const seed = { ...track("seed"), artists: ["Seed"], album: null };
  const library = [
    seed,
    ..."abcdefgh".split("").map((id) => ({
      ...track(id),
      artists: [id <= "e" ? "Artist A" : "Artist B"],
      album: null,
    })),
  ];
  const feedback: PlaylistRecommendationFeedback[] = [];
  let unavailable = false;
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      if (unavailable) throw new Error("read failed");
      return { playlist: [seed], sources: { library, catalog: [], graph: null, now: 0, feedback } };
    },
    dismiss: async (offer) => {
      feedback.push({ track: offer.track, value: -1 });
      unavailable = true;
    },
  });
  await session.renew();
  const before = session.get().slots;
  assert.deepEqual(
    before.map((offer) => offer?.track.id),
    ["a", "b", "c", "d", "e"],
  );
  assert.equal(await session.dismiss(before[2]!.key), true);
  assert.equal(session.get().error, "refill");
  await session.renew({ refillOnly: true });
  assert.equal(session.get().error, "refill");
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  unavailable = false;
  await session.renew({ refillOnly: true });
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id),
    ["a", "b", "f", "d", "e"],
  );
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.equal(session.get().error, null);
});

test("cancelled renewal and disposal cannot publish stale offers or keep listeners", async () => {
  const read = Promise.withResolvers<PlaylistRecommendationSessionInput>();
  let notifications = 0;
  const session = playlistRecommendationSession({
    newId: () => "offer",
    read: () => read.promise,
    dismiss: async () => {},
  });
  session.subscribe(() => notifications++);
  const controller = new AbortController();
  const renewing = session.renew({ signal: controller.signal });
  const before = notifications;
  controller.abort();
  read.resolve({
    playlist: [track("seed")],
    sources: { library: [track("next")], catalog: [], graph: null, now: 0 },
  });
  await renewing;
  assert.equal(notifications, before);
  assert.deepEqual(session.get().slots, []);
  session.dispose();
  await session.renew();
  assert.equal(notifications, before);
});

test("hiding during Add commits once, cancels its refill and retains held offers for return", async () => {
  const saved = Promise.withResolvers<void>();
  let reads = 0,
    writes = 0,
    notifications = 0;
  const session = playlistRecommendationSession({
    newId: () => String(reads) + Math.random(),
    read: async (signal) => {
      signal?.throwIfAborted();
      reads++;
      return {
        playlist: [track("seed")],
        sources: { library: "abcdefg".split("").map(track), catalog: [], graph: null, now: 0 },
      };
    },
    dismiss: async () => {},
    accept: async () => {
      writes++;
      await saved.promise;
    },
  });
  session.subscribe(() => notifications++);
  await session.renew();
  const before = session.get().slots;
  const adding = session.accept(before[2]!.key);
  session.pause();
  const heard = notifications;
  saved.resolve();
  assert.equal(await adding, true);
  assert.deepEqual([writes, reads, notifications], [1, 1, heard]);
  session.resume();
  await session.renew();
  assert.equal(
    session.get().slots.some((x) => x?.track.id === before[2]!.track.id),
    false,
  );
  for (const i of [0, 1, 3, 4]) assert.equal(session.get().slots[i]?.key, before[i]!.key);
});

/** A host whose turns ("paint", "free") wait until the test lets each go, in order. */
const heldTurns = (events: string[]) => {
  const waiting: (() => void)[] = [];
  return {
    yieldTurn: (kind: "paint" | "free") =>
      new Promise<void>((resolve) => {
        events.push(kind);
        waiting.push(resolve);
      }),
    /** Lets the oldest waiting turn go, once the session got to it. */
    next: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      waiting.shift()!();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
};

test("a tap's slot holds a placeholder from the tap on; saving, reading and ranking each wait for the host's turn", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcdefgh".split("").map(track)];
  let playlist = [seed];
  const events: string[] = [];
  const host = heldTurns(events);
  let id = 0;
  let saves = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      events.push("read");
      return { playlist, sources: { library, catalog: [], graph: null, now: 0 } };
    },
    dismiss: async () => {},
    accept: async (offer) => {
      events.push("save");
      saves++;
      playlist = [...playlist, offer.track];
    },
    yieldTurn: host.yieldTurn,
  });
  const renewing = session.renew();
  await host.next(); // a full renewal ranks on its own turn after reading
  await renewing;
  events.length = 0;
  const before = session.get().slots;
  const adding = session.accept(before[2]!.key);
  // Synchronously: the tap is acknowledged before any storage work runs.
  assert.equal(session.get().pending, before[2]!.key);
  assert.deepEqual(session.get().pendingSlots, [2]);
  assert.equal(saves, 0);
  // Repeated taps on any offer meanwhile change nothing.
  assert.equal(await session.accept(before[2]!.key), false);
  assert.equal(await session.dismiss(before[0]!.key), false);
  await host.next(); // paint
  assert.equal(saves, 1);
  assert.equal(session.get().slots[2], null);
  assert.deepEqual(session.get().pendingSlots, [2]);
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.equal(await session.accept(before[3]!.key), false);
  await host.next(); // free
  await host.next(); // paint, then rank
  assert.equal(await adding, true);
  assert.deepEqual(events, ["paint", "save", "free", "read", "paint"]);
  assert.equal(saves, 1);
  assert.equal(session.get().slots[2]?.track.id, "f");
  assert.deepEqual(session.get().pendingSlots, []);
  assert.equal(session.get().pending, null);
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
});

test("an exhausted pool leaves the freed slot empty, without an error or a placeholder", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcde".split("").map(track)];
  let saves = 0;
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({
      playlist: [seed],
      sources: { library, catalog: [], graph: null, now: 0 },
    }),
    dismiss: async () => {
      saves++;
    },
  });
  await session.renew();
  const before = session.get().slots;
  assert.equal(await session.dismiss(before[1]!.key), true);
  assert.equal(saves, 1);
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id ?? null),
    ["a", null, "c", "d", "e"],
  );
  for (const index of [0, 2, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.equal(session.get().error, null);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.deepEqual(session.get().unfilled, []);
});

test("a failed save restores its offer in place and retries with one more write", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcdefg".split("").map(track)];
  let fail = true;
  const written: string[] = [];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({
      playlist: [seed],
      sources: { library, catalog: [], graph: null, now: 0 },
    }),
    dismiss: async () => {},
    accept: async (offer) => {
      if (fail) throw new Error("disk full");
      written.push(offer.key);
    },
  });
  await session.renew();
  const before = session.get().slots;
  assert.equal(await session.accept(before[3]!.key), false);
  assert.deepEqual(session.get().slots, before);
  assert.equal(session.get().slots[3], before[3]);
  assert.equal(session.get().error, "save");
  assert.deepEqual(session.get().pendingSlots, []);
  fail = false;
  assert.equal(await session.accept(before[3]!.key), true);
  assert.equal(await session.accept(before[3]!.key), false);
  assert.deepEqual(written, [before[3]!.key]);
  assert.equal(session.get().error, null);
  assert.deepEqual(session.get().unfilled, []);
});

test("a failed replacement keeps its slot's place; the retry holds a placeholder there and never saves again", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcdefgh".split("").map(track)];
  let unavailable = false;
  let saves = 0;
  const events: string[] = [];
  const host = heldTurns(events);
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      if (unavailable) throw new Error("read failed");
      return { playlist: [seed], sources: { library, catalog: [], graph: null, now: 0 } };
    },
    dismiss: async () => {
      saves++;
      unavailable = true;
    },
    yieldTurn: host.yieldTurn,
  });
  const renewing = session.renew();
  await host.next();
  await renewing;
  const before = session.get().slots;
  const dismissing = session.dismiss(before[2]!.key);
  await host.next(); // paint, then save
  await host.next(); // free, then the read fails
  assert.equal(await dismissing, true);
  assert.equal(session.get().slots[2], null);
  assert.equal(session.get().error, "refill");
  assert.deepEqual(session.get().unfilled, [2]);
  assert.deepEqual(session.get().pendingSlots, []);
  unavailable = false;
  const retry = session.renew({ refillOnly: true });
  assert.deepEqual(session.get().pendingSlots, [2]);
  assert.equal(session.get().error, null);
  assert.equal(session.get().loading, false);
  await host.next(); // paint, then read
  await host.next(); // paint, then rank
  await retry;
  assert.equal(saves, 1);
  assert.equal(session.get().slots[2]?.track.id, "f");
  assert.deepEqual(session.get().pendingSlots, []);
  assert.deepEqual(session.get().unfilled, []);
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
});

test("the next action's refill also fills a slot whose replacement failed before", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcdefgh".split("").map(track)];
  let unavailable = false;
  let saves = 0;
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      if (unavailable) throw new Error("read failed");
      return { playlist: [seed], sources: { library, catalog: [], graph: null, now: 0 } };
    },
    dismiss: async () => {
      saves++;
    },
  });
  await session.renew();
  const before = session.get().slots;
  unavailable = true;
  assert.equal(await session.dismiss(before[2]!.key), true);
  assert.deepEqual(session.get().unfilled, [2]);
  unavailable = false;
  const next = session.dismiss(before[0]!.key);
  // Both freed slots hold a placeholder while the one refill fills them.
  assert.deepEqual(session.get().pendingSlots, [0, 2]);
  assert.equal(await next, true);
  assert.equal(saves, 2);
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id ?? null),
    ["f", "b", "g", "d", "e"],
  );
  for (const index of [1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.equal(session.get().error, null);
  assert.deepEqual(session.get().unfilled, []);
});

test("each full renewal reports how long its read and ranking took and how many offers it showed", async () => {
  const seed = track("seed");
  let clock = 0;
  let fail = false;
  const timings: PlaylistRecommendationTiming[] = [];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      clock += 1_200;
      if (fail) throw new Error("timed out");
      return {
        playlist: [seed],
        sources: {
          library: [seed, ...["a", "b", "c"].map(track)],
          catalog: [],
          graph: null,
          now: 0,
        },
      };
    },
    rank: async (input) => {
      clock += 300;
      return input.sources.library.slice(1).map((offer) => ({ track: offer, score: 1 }));
    },
    dismiss: async () => {},
    timed: { now: () => clock, report: (timing) => timings.push(timing) },
  });
  await session.renew();
  assert.deepEqual(timings, [{ ms: 1_500, readMs: 1_200, rankMs: 300, offers: 3, failed: false }]);
  // A refill retry fills holes only; it isn't a renewal of the suggestions.
  await session.renew({ refillOnly: true });
  assert.equal(timings.length, 1);
  fail = true;
  await session.renew();
  assert.deepEqual(timings[1], { ms: 1_200, readMs: 1_200, rankMs: 0, offers: 3, failed: true });
  // A cancelled renewal took no time anyone waited for.
  const controller = new AbortController();
  fail = false;
  const renewing = session.renew({ signal: controller.signal });
  controller.abort();
  await renewing;
  assert.equal(timings.length, 2);
});

test("a renewal's timing reads as one log line, from the playlist's opening when it was the first", () => {
  const shown = { ms: 1_534.4, readMs: 1_201, rankMs: 299.6, offers: 5, failed: false };
  assert.equal(
    playlistSuggestionsLine(shown, 2_410.2),
    "Playlist suggestions: 5 offers 2410 ms after opening (read 1201 ms, rank 300 ms)",
  );
  assert.equal(
    playlistSuggestionsLine({ ...shown, offers: 1 }),
    "Playlist suggestions renewed: 1 offer in 1534 ms (read 1201 ms, rank 300 ms)",
  );
  assert.equal(
    playlistSuggestionsLine(
      { ms: 60_000, readMs: 60_000, rankMs: 0, offers: 0, failed: true },
      60_400,
    ),
    "Playlist suggestions failed 60400 ms after opening (read 60000 ms, rank 0 ms)",
  );
});
