import assert from "node:assert/strict";
import { test } from "node:test";
import {
  playlistRecommendations,
  playlistRecommendationSession,
  playlistSlotWaitLine,
  playlistSuggestionsLine,
  type PlaylistRecommendationTiming,
  type PlaylistSlotWait,
  type PlaylistRecommendationFeedback,
  type PlaylistRecommendationSessionInput,
  type PlaylistRecommendationTrack,
  type RadioRankingPage,
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

/** One radio bringing [library]'s songs in order, as a drawn seed's would. */
const radioOf = (library: readonly PlaylistRecommendationTrack[]) => [
  { id: "song:seed", artists: ["Artist seed"], songs: library },
];

test("the next refill reads newly favorited or downloaded candidates ahead of ordinary matches", async () => {
  const seed = track("seed");
  let library = [seed, ..."abcdefgh".split("").map(track)];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({
      playlist: [seed],
      sources: { library, pages: radioOf(library), graph: null },
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

test("a renewal saves newly favorited and downloaded matches first, leaving all five slots as they are", async () => {
  const seed = track("seed");
  let library = [seed, ..."abcdefgh".split("").map(track)];
  let id = 0;
  let saved: readonly PlaylistRecommendationTrack[] = [];
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({
      playlist: [seed],
      sources: { library, pages: radioOf(library), graph: null },
    }),
    dismiss: async () => {},
    saved: {
      offers: [],
      online: () => true,
      write: (offers) => {
        saved = offers;
      },
    },
  });
  await session.renew();
  const shown = session.get().slots;
  library = library.map((song) => ({ ...song, favorite: song.id === "h" }));
  await session.renew();
  assert.equal(saved[0]?.id, "h");
  library = library.map((song) => ({ ...song, favorite: false, downloaded: song.id === "g" }));
  await session.renew();
  assert.equal(saved[0]?.id, "g");
  assert.equal(session.get().slots, shown);
});

test("unchanged playlist membership does not keep removed Library candidates offered", async () => {
  const seed = track("seed");
  let library = [seed, ..."abcde".split("").map(track)];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({
      playlist: [seed],
      sources: { library, pages: radioOf(library), graph: null },
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
          sources: { library, pages: radioOf(library), graph: null },
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

test("acceptance preserves the four held offers and keys; a later external edit leaves them", async () => {
  const seed = track("seed");
  let playlist = [seed];
  let library = [seed, ..."abcdefgh".split("").map(track)];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({ playlist, sources: { library, pages: radioOf(library), graph: null } }),
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
  const after = session.get().slots;
  await session.renew();
  assert.equal(session.get().slots, after);
});

test("an external addition of a held offer is not acknowledged as Add's own notification", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcdefgh".split("").map(track)];
  let playlist = [seed];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({ playlist, sources: { library, pages: radioOf(library), graph: null } }),
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
        sources: { library: [track("unused")], pages: radioOf([track("unused")]), graph: null },
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

test("favorite and download source changes during Add reach the single-slot refill, not the others", async () => {
  const seed = track("seed");
  let playlist = [seed];
  let library = [seed, ..."abcdefgh".split("").map(track)];
  let id = 0;
  let release!: () => void;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({ playlist, sources: { library, pages: radioOf(library), graph: null } }),
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
    ["a", "b", "d", "e", "g"],
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
    read: async () => ({ playlist, sources: { library, pages: radioOf(library), graph: null } }),
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
      sources: { library, pages: radioOf(library), graph: null },
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
      return { playlist: [seed], sources: { library, pages: radioOf(library), graph: null } };
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
      artists: [id <= "e" ? `Artist ${id}` : "Artist B"],
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
      return {
        playlist: [seed],
        sources: { library, pages: radioOf(library), graph: null, feedback },
      };
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
    sources: { library: [track("next")], pages: radioOf([track("next")]), graph: null },
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
        sources: {
          library: "abcdefg".split("").map(track),
          pages: radioOf("abcdefg".split("").map(track)),
          graph: null,
        },
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
      return { playlist, sources: { library, pages: radioOf(library), graph: null } };
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
  assert.deepEqual(session.get().pending, [before[2]!.key]);
  assert.deepEqual(session.get().pendingSlots, [2]);
  assert.equal(saves, 0);
  // Repeated taps on the same offer meanwhile change nothing.
  assert.equal(await session.accept(before[2]!.key), false);
  await host.next(); // paint
  assert.equal(saves, 1);
  assert.equal(session.get().slots[2], null);
  assert.deepEqual(session.get().pendingSlots, [2]);
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  await host.next(); // free
  await host.next(); // paint, then rank
  assert.equal(await adding, true);
  assert.deepEqual(events, ["paint", "save", "free", "read", "paint"]);
  assert.equal(saves, 1);
  assert.equal(session.get().slots[2]?.track.id, "f");
  assert.deepEqual(session.get().pendingSlots, []);
  assert.deepEqual(session.get().pending, []);
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
      sources: { library, pages: radioOf(library), graph: null },
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
      sources: { library, pages: radioOf(library), graph: null },
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
      return { playlist: [seed], sources: { library, pages: radioOf(library), graph: null } };
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
      return { playlist: [seed], sources: { library, pages: radioOf(library), graph: null } };
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
          graph: null,
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

test("a refill keeps the five offers to at most 2 songs by one artist, counting those held", async () => {
  const seed = track("seed");
  const by = (id: string, artist: string) => ({ ...track(id), artists: [artist] });
  const library = [
    seed,
    by("a", "X"),
    by("b", "X"),
    by("c", "Y"),
    by("d", "Z"),
    by("e", "W"),
    by("f", "X"),
    by("g", "V"),
  ];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({
      playlist: [seed],
      sources: { library, pages: radioOf(library), graph: null },
    }),
    dismiss: async () => {},
  });
  await session.renew();
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id),
    ["a", "b", "c", "d", "e"],
  );
  assert.equal(await session.dismiss(session.get().slots[2]!.key), true);
  assert.equal(session.get().slots[2]?.track.id, "g");
  await session.renew();
  const artists = session.get().slots.flatMap((offer) => offer?.track.artists ?? []);
  assert.ok(artists.filter((name) => name === "X").length <= 2);
});

test("a tap on another offer while the first one saves is taken at once and saved after it", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcdefghij".split("").map(track)];
  let playlist = [seed];
  const first = Promise.withResolvers<void>();
  const written: string[] = [];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({ playlist, sources: { library, pages: radioOf(library), graph: null } }),
    dismiss: async (offer) => {
      written.push(`dismiss ${offer.track.id}`);
    },
    accept: async (offer) => {
      if (written.length === 0) await first.promise;
      written.push(`add ${offer.track.id}`);
      playlist = [...playlist, offer.track];
    },
  });
  await session.renew();
  const before = session.get().slots;
  const adding = session.accept(before[1]!.key);
  const dismissing = session.dismiss(before[3]!.key);
  // Both taps hold their slot's placeholder at once; the others keep theirs.
  assert.deepEqual(session.get().pending, [before[1]!.key, before[3]!.key]);
  assert.deepEqual(session.get().pendingSlots, [1, 3]);
  // A repeated tap on an offer whose save is under way writes nothing more.
  assert.equal(await session.accept(before[1]!.key), false);
  first.resolve();
  assert.deepEqual(await Promise.all([adding, dismissing]), [true, true]);
  assert.deepEqual(written, ["add b", "dismiss d"]);
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id ?? null),
    ["a", "f", "c", "g", "e"],
  );
  for (const index of [0, 2, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.deepEqual(session.get().pending, []);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.equal(session.get().error, null);
});

/** A session over seed + a…j whose reads wait while [gate.hold] is set. */
const gatedSession = (
  options: {
    readonly dismiss?: (offer: { readonly track: PlaylistRecommendationTrack }) => Promise<void>;
    readonly accept?: (offer: { readonly track: PlaylistRecommendationTrack }) => Promise<void>;
    /** Whether the [n]th read fails, counting from 1. */
    readonly fail?: (n: number) => boolean;
    readonly report?: (timing: PlaylistRecommendationTiming) => void;
  } = {},
) => {
  const seed = track("seed");
  const gate: {
    hold: PromiseWithResolvers<void> | undefined;
    reads: number;
    playlist: PlaylistRecommendationTrack[];
    library: PlaylistRecommendationTrack[];
  } = {
    hold: undefined,
    reads: 0,
    playlist: [seed],
    library: [seed, ..."abcdefghij".split("").map(track)],
  };
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      const n = ++gate.reads;
      const hold = gate.hold;
      gate.hold = undefined;
      await hold?.promise;
      if (options.fail?.(n) === true) throw new Error("read failed");
      return {
        playlist: gate.playlist,
        sources: { library: gate.library, pages: radioOf(gate.library), graph: null },
      };
    },
    dismiss: options.dismiss ?? (async () => {}),
    accept:
      options.accept ??
      (async (offer) => {
        gate.playlist = [...gate.playlist, offer.track];
      }),
    ...(options.report === undefined ? {} : { timed: { now: () => 0, report: options.report } }),
  });
  return { session, gate };
};

test("slots freed while a replacement is read wait for the next refill, which leaves the others in place", async () => {
  const { session, gate } = gatedSession();
  await session.renew();
  const before = session.get().slots;
  gate.hold = Promise.withResolvers();
  const hold = gate.hold;
  const first = session.dismiss(before[0]!.key);
  await new Promise((resolve) => setImmediate(resolve));
  // The first refill is reading; the second slot is freed meanwhile.
  const second = session.accept(before[2]!.key);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id ?? null),
    [null, "b", null, "d", "e"],
  );
  assert.deepEqual(session.get().pendingSlots, [0, 2]);
  assert.equal(gate.reads, 2);
  hold.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(gate.reads, 3);
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id ?? null),
    ["f", "b", "g", "d", "e"],
  );
  for (const index of [1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.deepEqual(
    gate.playlist.map((song) => song.id),
    ["seed", "c"],
  );
  assert.deepEqual(session.get().pendingSlots, []);
});

test("a failed save among concurrent actions restores only its own offer", async () => {
  const { session } = gatedSession({
    accept: async () => {
      throw new Error("disk full");
    },
  });
  await session.renew();
  const before = session.get().slots;
  const adding = session.accept(before[1]!.key);
  const dismissing = session.dismiss(before[3]!.key);
  assert.deepEqual(await Promise.all([adding, dismissing]), [false, true]);
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id ?? null),
    ["a", "b", "c", "f", "e"],
  );
  assert.equal(session.get().slots[1], before[1]);
  assert.equal(session.get().error, "save");
  assert.deepEqual(session.get().pending, []);
  assert.deepEqual(session.get().pendingSlots, []);
  // The restored offer's action works again.
  assert.equal(await session.dismiss(before[1]!.key), true);
  assert.equal(session.get().slots[1]?.track.id, "g");
});

test("Try Again while another offer's replacement is read retries its slot alongside, without saving again", async () => {
  // The renewal reads first, then the first refill, which fails.
  const written: string[] = [];
  const { session, gate } = gatedSession({
    fail: (n) => n === 2,
    dismiss: async (offer) => {
      written.push(offer.track.id);
    },
  });
  await session.renew();
  const before = session.get().slots;
  assert.equal(await session.dismiss(before[0]!.key), true);
  assert.deepEqual(session.get().unfilled, [0]);
  assert.equal(session.get().error, "refill");
  gate.hold = Promise.withResolvers();
  const hold = gate.hold;
  const dismissing = session.dismiss(before[2]!.key);
  // The tap takes the failed slot into its own refill, which is reading.
  assert.deepEqual(session.get().pendingSlots, [2, 0]);
  await new Promise((resolve) => setImmediate(resolve));
  // With nothing left to retry, Try Again does nothing more.
  await session.renew({ refillOnly: true });
  hold.resolve();
  assert.equal(await dismissing, true);
  assert.deepEqual(written, ["a", "c"]);
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id ?? null),
    ["g", "b", "f", "d", "e"],
  );
  assert.deepEqual(session.get().unfilled, []);
  assert.deepEqual(session.get().pendingSlots, []);
  for (const index of [1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
});

test("a tap during a Try Again is taken at once and its slot filled after the retried one", async () => {
  const { session, gate } = gatedSession({ fail: (n) => n === 2 });
  await session.renew();
  const before = session.get().slots;
  assert.equal(await session.dismiss(before[0]!.key), true);
  assert.deepEqual(session.get().unfilled, [0]);
  gate.hold = Promise.withResolvers();
  const hold = gate.hold;
  const retry = session.renew({ refillOnly: true });
  await new Promise((resolve) => setImmediate(resolve));
  const dismissing = session.dismiss(before[3]!.key);
  assert.deepEqual(session.get().pendingSlots, [0, 3]);
  hold.resolve();
  await retry;
  assert.equal(await dismissing, true);
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id ?? null),
    ["f", "b", "c", "g", "e"],
  );
  assert.deepEqual(session.get().unfilled, []);
  assert.equal(session.get().error, null);
});

test("hiding during concurrent actions keeps every save and leaves no slot as a placeholder", async () => {
  const saved = Promise.withResolvers<void>();
  const written: string[] = [];
  const { session, gate } = gatedSession({
    accept: async (offer) => {
      await saved.promise;
      written.push(offer.track.id);
    },
    dismiss: async (offer) => {
      written.push(offer.track.id);
    },
  });
  await session.renew();
  let notifications = 0;
  session.subscribe(() => notifications++);
  const before = session.get().slots;
  const adding = session.accept(before[0]!.key);
  const dismissing = session.dismiss(before[2]!.key);
  session.pause();
  const heard = notifications;
  saved.resolve();
  assert.deepEqual(await Promise.all([adding, dismissing]), [true, true]);
  assert.deepEqual(written, ["a", "c"]);
  assert.deepEqual([gate.reads, notifications], [1, heard]);
  assert.deepEqual(session.get().pending, []);
  assert.deepEqual(session.get().pendingSlots, []);
  assert.deepEqual(session.get().unfilled, [0, 2]);
  assert.equal(session.get().error, null);
  session.resume();
  await session.renew();
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id ?? null),
    ["f", "b", "g", "d", "e"],
  );
  assert.deepEqual(session.get().unfilled, []);
});

test("a renewal asked for during concurrent actions runs once, after the last replacement", async () => {
  const timings: PlaylistRecommendationTiming[] = [];
  const saved = Promise.withResolvers<void>();
  const { session, gate } = gatedSession({
    report: (timing) => timings.push(timing),
    accept: async (offer) => {
      await saved.promise;
      gate.playlist = [...gate.playlist, offer.track];
    },
  });
  await session.renew();
  const before = session.get().slots;
  const adding = session.accept(before[0]!.key);
  const dismissing = session.dismiss(before[2]!.key);
  gate.library = gate.library.map((song) => ({ ...song, favorite: song.id === "j" }));
  await session.renew();
  await session.renew();
  assert.equal(timings.length, 1);
  assert.equal(session.get().loading, false);
  saved.resolve();
  assert.deepEqual(await Promise.all([adding, dismissing]), [true, true]);
  assert.equal(timings.length, 2);
  assert.equal(
    session.get().slots.some((offer) => offer?.track.id === "j"),
    true,
  );
  assert.equal(
    session.get().slots.some((offer) => offer?.track.id === "a" || offer?.track.id === "c"),
    false,
  );
});

test("a slot whose replacement failed is filled by the refill already waiting, and a failed save keeps its message", async () => {
  // The renewal reads first, then the first refill, which fails.
  const { session, gate } = gatedSession({
    fail: (n) => n === 2,
    accept: async (offer) => {
      if (offer.track.id === "b") throw new Error("disk full");
      gate.playlist = [...gate.playlist, offer.track];
    },
  });
  await session.renew();
  const before = session.get().slots;
  gate.hold = Promise.withResolvers();
  const hold = gate.hold;
  const first = session.dismiss(before[0]!.key);
  await new Promise((resolve) => setImmediate(resolve));
  const failing = session.accept(before[1]!.key);
  const second = session.dismiss(before[2]!.key);
  assert.equal(await failing, false);
  assert.equal(session.get().error, "save");
  hold.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(
    session.get().slots.map((offer) => offer?.track.id ?? null),
    ["g", "b", "f", "d", "e"],
  );
  assert.deepEqual(session.get().unfilled, []);
  assert.deepEqual(session.get().pendingSlots, []);
  // The refill's failure didn't hide that b's choice still needs another try.
  assert.equal(session.get().error, "save");
  assert.equal(session.get().slots[1], before[1]);
});

test("closing the playlist during concurrent actions still writes every tapped choice, and publishes nothing", async () => {
  const saved = Promise.withResolvers<void>();
  const written: string[] = [];
  const { session, gate } = gatedSession({
    accept: async (offer) => {
      await saved.promise;
      written.push(offer.track.id);
    },
    dismiss: async (offer) => {
      written.push(offer.track.id);
    },
  });
  await session.renew();
  let notifications = 0;
  session.subscribe(() => notifications++);
  const before = session.get().slots;
  const adding = session.accept(before[0]!.key);
  const dismissing = session.dismiss(before[2]!.key);
  const heard = notifications;
  session.dispose();
  saved.resolve();
  assert.deepEqual(await Promise.all([adding, dismissing]), [true, true]);
  assert.deepEqual(written, ["a", "c"]);
  assert.deepEqual([gate.reads, notifications], [1, heard]);
});

test("a renewal asked for with a turn shows it's loading, then reads on that turn", async () => {
  const seed = track("seed");
  const turn = Promise.withResolvers<void>();
  const turns: string[] = [];
  let reads = 0;
  const session = playlistRecommendationSession({
    newId: () => "id",
    read: async () => {
      reads++;
      return { playlist: [seed], sources: { library: [], graph: null } };
    },
    dismiss: async () => {},
    yieldTurn: (kind) => {
      turns.push(kind);
      return kind === "free" ? turn.promise : Promise.resolve();
    },
  });
  const renewed = session.renew({ turn: "free" });
  assert.equal(session.get().loading, true);
  assert.deepEqual(turns, ["free"]);
  assert.equal(reads, 0, "the read waits for its turn");
  turn.resolve();
  await renewed;
  assert.equal(reads, 1);
  assert.equal(session.get().loading, false);
});

test("hiding during a renewal's turn cancels it before it reads", async () => {
  const seed = track("seed");
  const turn = Promise.withResolvers<void>();
  let reads = 0;
  const session = playlistRecommendationSession({
    newId: () => "id",
    read: async () => {
      reads++;
      return { playlist: [seed], sources: { library: [], graph: null } };
    },
    dismiss: async () => {},
    yieldTurn: () => turn.promise,
  });
  const renewed = session.renew({ turn: "paint" });
  session.pause();
  turn.resolve();
  await renewed;
  assert.equal(reads, 0);
  assert.equal(session.get().error, null);
});

test("a renewal held for a save reads on a free turn once the save is done", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcdefg".split("").map(track)];
  const saved = Promise.withResolvers<void>();
  const log: string[] = [];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      log.push("read");
      return { playlist: [seed], sources: { library, pages: radioOf(library), graph: null } };
    },
    dismiss: async () => saved.promise,
    yieldTurn: async (kind) => {
      log.push(kind);
    },
  });
  await session.renew();
  const dismissed = session.dismiss(session.get().slots[0]!.key);
  await session.renew();
  log.length = 0;
  saved.resolve();
  await dismissed;
  // The refill's own free turn and read, then the held renewal's.
  assert.deepEqual(log, ["free", "read", "paint", "free", "read", "paint"]);
});

/** A session on a hand-moved clock: reading takes 700 ms and ranking 300, and [host] says what fails. */
const slotWaitSession = (
  host: {
    readFails?: () => boolean;
    saveFails?: () => boolean;
    letters?: string;
    beforeRead?: () => Promise<void>;
    yieldTurn?: (kind: "paint" | "free") => Promise<void>;
  } = {},
) => {
  const seed = track("seed");
  const library = [seed, ...(host.letters ?? "abcdefghij").split("").map(track)];
  const waits: PlaylistSlotWait[] = [];
  let clock = 0;
  let id = 0;
  const save = async () => {
    clock += 50;
    if (host.saveFails?.() === true) throw new Error("no write");
  };
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      await host.beforeRead?.();
      clock += 700;
      if (host.readFails?.() === true) throw new Error("timed out");
      return { playlist: [seed], sources: { library, pages: radioOf(library), graph: null } };
    },
    rank: async (input) => {
      clock += 300;
      const taken = input.sources.exclude ?? [];
      return input.sources.library
        .slice(1)
        .filter((offer) => !taken.some((other) => other.id === offer.id))
        .map((offer) => ({ track: offer, score: 1 }));
    },
    dismiss: save,
    accept: save,
    ...(host.yieldTurn === undefined ? {} : { yieldTurn: host.yieldTurn }),
    timed: { now: () => clock, report: () => {}, slotWait: (wait) => waits.push(wait) },
  });
  return {
    session,
    waits,
    pass: (ms: number) => {
      clock += ms;
    },
  };
};

test("an Add and a Dismiss each time their wait from the tap until the ranking's offer shows", async () => {
  const { session, waits } = slotWaitSession();
  await session.renew();
  assert.deepEqual(waits, []);
  await session.accept(session.get().slots[0]!.key);
  await session.dismiss(session.get().slots[1]!.key);
  assert.deepEqual(waits, [
    { action: "add", ms: 1_050, outcome: "offer", from: "ranking" },
    { action: "dismiss", ms: 1_050, outcome: "offer", from: "ranking" },
  ]);
});

test("a slot's wait reads as one log line saying what came of it and where its offer came from", () => {
  const line = playlistSlotWaitLine;
  assert.equal(
    line({ action: "add", ms: 8_204.4, outcome: "offer", from: "ranking" }),
    "Playlist slot wait: Add offer after 8204 ms (from ranking)",
  );
  assert.equal(
    line({ action: "dismiss", ms: 120, outcome: "offer", from: "spare" }),
    "Playlist slot wait: Dismiss offer after 120 ms (from spare)",
  );
  assert.equal(
    line({ action: "add", ms: 900, outcome: "no offer", from: "placeholder" }),
    "Playlist slot wait: Add no offer after 900 ms (from placeholder)",
  );
  assert.equal(
    line({ action: "dismiss", ms: 8_000, outcome: "refill failed", from: "placeholder" }),
    "Playlist slot wait: Dismiss refill failed after 8000 ms (from placeholder)",
  );
  assert.equal(
    line({ action: "add", ms: 300, outcome: "cancelled", from: "placeholder" }),
    "Playlist slot wait: Add cancelled after 300 ms (from placeholder)",
  );
  assert.equal(
    line({ action: "add", ms: 40, outcome: "save failed", from: "placeholder" }),
    "Playlist slot wait: Add save failed after 40 ms (from placeholder)",
  );
});

test("a slot nothing can fill ends its wait with no offer", async () => {
  const { session, waits } = slotWaitSession({ letters: "abcde" });
  await session.renew();
  await session.dismiss(session.get().slots[0]!.key);
  assert.deepEqual(waits, [
    { action: "dismiss", ms: 1_050, outcome: "no offer", from: "placeholder" },
  ]);
});

test("a failed refill says so once, and its retry isn't another wait", async () => {
  let readFails = false;
  const { session, waits } = slotWaitSession({ readFails: () => readFails });
  await session.renew();
  readFails = true;
  await session.accept(session.get().slots[0]!.key);
  assert.deepEqual(waits, [
    { action: "add", ms: 750, outcome: "refill failed", from: "placeholder" },
  ]);
  readFails = false;
  await session.renew({ refillOnly: true });
  assert.notEqual(session.get().slots[0], null);
  assert.equal(waits.length, 1);
});

test("a refill cancelled by hiding the screen says so, as does one cancelled before it read", async () => {
  const reading = Promise.withResolvers<void>();
  let hold = false;
  const { session, waits } = slotWaitSession({
    beforeRead: () => (hold ? reading.promise : Promise.resolve()),
  });
  await session.renew();
  hold = true;
  const during = session.dismiss(session.get().slots[0]!.key);
  await new Promise((resolve) => setImmediate(resolve));
  session.pause();
  reading.resolve();
  await during;
  assert.deepEqual(
    waits.map((wait) => wait.outcome),
    ["cancelled"],
  );
  assert.equal(waits[0]?.from, "placeholder");
  session.resume();
  hold = false;
  const saving = session.accept(session.get().slots[1]!.key);
  session.dispose();
  await saving;
  assert.deepEqual(
    waits.map((wait) => wait.outcome),
    ["cancelled", "cancelled"],
  );
});

test("a failed save ends the wait with its offer back, not as an offer shown", async () => {
  let saveFails = true;
  const { session, waits } = slotWaitSession({ saveFails: () => saveFails });
  await session.renew();
  const offer = session.get().slots[0]!;
  assert.equal(await session.accept(offer.key), false);
  assert.deepEqual(waits, [{ action: "add", ms: 50, outcome: "save failed", from: "placeholder" }]);
  saveFails = false;
  assert.equal(await session.accept(offer.key), true);
  assert.deepEqual(waits[1], { action: "add", ms: 1_050, outcome: "offer", from: "ranking" });
});

test("quick taps each time their own slot, and a repeated tap adds no wait", async () => {
  const reading = Promise.withResolvers<void>();
  let hold = false;
  const { session, waits, pass } = slotWaitSession({
    beforeRead: () => (hold ? reading.promise : Promise.resolve()),
  });
  await session.renew();
  hold = true;
  const [first, second] = session.get().slots;
  const firstTap = session.accept(first!.key);
  assert.equal(await session.accept(first!.key), false);
  await new Promise((resolve) => setImmediate(resolve));
  pass(1_000);
  const secondTap = session.dismiss(second!.key);
  await new Promise((resolve) => setImmediate(resolve));
  reading.resolve();
  hold = false;
  await Promise.all([firstTap, secondTap]);
  // The first refill ends at 2,100 by the clock, tapped at 0. The second slot waits for it
  // and reads again, ending at 3,100, tapped at 1,050.
  assert.deepEqual(waits, [
    { action: "add", ms: 2_100, outcome: "offer", from: "ranking" },
    { action: "dismiss", ms: 2_050, outcome: "offer", from: "ranking" },
  ]);
});

test("an offer's wait lasts until the frame showing it, and a later tap doesn't wait for that frame", async () => {
  const frames: (() => void)[] = [];
  let holdFrames = false;
  const { session, waits, pass } = slotWaitSession({
    yieldTurn: (kind) =>
      holdFrames && kind === "paint"
        ? new Promise((resolve) => frames.push(resolve))
        : Promise.resolve(),
  });
  await session.renew();
  const acting = session.accept(session.get().slots[0]!.key);
  await new Promise((resolve) => setImmediate(resolve));
  // The offer landed; its frame is the turn held from here on.
  await acting;
  assert.notEqual(session.get().slots[0], null);
  assert.equal(waits.length, 1);
  holdFrames = true;
  const next = session.dismiss(session.get().slots[1]!.key);
  // The write's own paint turn.
  await new Promise((resolve) => setImmediate(resolve));
  frames.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  // The read's paint turn before ranking.
  frames.shift()!();
  await next;
  assert.equal(waits.length, 1);
  pass(16);
  frames.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(waits[1], { action: "dismiss", ms: 1_066, outcome: "offer", from: "ranking" });
});

/** A fresh suggestion's session whose radios answer when the test says, with its offers saved. */
const freshSuggestion = (library: readonly PlaylistRecommendationTrack[], radios: number) => {
  const answers = Array.from({ length: radios }, () =>
    Promise.withResolvers<RadioRankingPage | null>(),
  );
  const ranks: (readonly string[])[] = [];
  const reports: PlaylistRecommendationTiming[] = [];
  const saved: { offers: readonly PlaylistRecommendationTrack[] } = { offers: [] };
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      throw new Error("a fresh suggestion reads its radios one by one");
    },
    readFresh: async () => ({
      input: { playlist: [track("seed")], sources: { library, pages: [], graph: null } },
      radios: answers.map((answer) => answer.promise),
    }),
    rank: async (input) => {
      ranks.push((input.sources.pages ?? []).map((page) => page.id));
      return playlistRecommendations(input.playlist, input.sources, 20);
    },
    dismiss: async () => {},
    saved: {
      offers: [],
      online: () => true,
      write: (offers) => {
        saved.offers = offers;
      },
    },
    timed: { now: () => 0, report: (timing) => reports.push(timing) },
  });
  return {
    session,
    ranks,
    reports,
    saved,
    answer: (radio: number, ids: string) =>
      answers[radio]!.resolve({
        id: `song:${radio}`,
        artists: [`Seed ${radio}`],
        songs: ids.split("").map(track),
      }),
    noAnswer: (radio: number) => answers[radio]!.resolve(null),
    fail: (radio: number) => answers[radio]!.reject(new Error("radio failed")),
    showing: () => session.get().slots.map((offer) => offer?.track.id ?? null),
  };
};
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("").map(track);

/** Lets everything the session can do without a new answer finish. */
const quiet = () => new Promise((resolve) => setImmediate(resolve));

test("a fresh suggestion shows its offers from the first radio to answer, the others unanswered", async () => {
  const fresh = freshSuggestion(LETTERS, 3);
  const renewal = fresh.session.renew();
  await quiet();
  assert.equal(fresh.session.get().loading, true);

  fresh.answer(1, "abcdefg");
  await quiet();

  assert.deepEqual(fresh.showing(), ["a", "b", "c", "d", "e"]);
  assert.equal(fresh.session.get().loading, false);
  assert.deepEqual(fresh.ranks, [["song:1"]]);
  assert.equal(fresh.reports.length, 1);
  assert.equal(fresh.reports[0]!.offers, 5);
  assert.equal(fresh.reports[0]!.failed, false);

  fresh.noAnswer(0);
  fresh.noAnswer(2);
  await renewal;
  assert.equal(fresh.session.get().error, null);
});

test("the later radios add spares, behind the offers showing, and Dismiss takes them", async () => {
  const fresh = freshSuggestion(LETTERS, 3);
  const renewal = fresh.session.renew();
  fresh.answer(0, "abcdefg");
  await quiet();
  const shown = fresh.session.get().slots;

  fresh.answer(2, "hij");
  await quiet();
  fresh.answer(1, "akl");
  await renewal;

  assert.equal(fresh.session.get().slots, shown);
  assert.deepEqual(
    fresh.saved.offers.map((offer) => offer.id),
    [..."abcdefghijkl"],
  );
  assert.deepEqual(fresh.ranks, [["song:0"], ["song:2"], ["song:1"]]);
  assert.equal(fresh.reports.length, 1);
});

test("a first radio short of five shows what it has, and the later radios fill the empty slots", async () => {
  const fresh = freshSuggestion(LETTERS, 3);
  const renewal = fresh.session.renew();
  fresh.answer(2, "ab");
  await quiet();
  assert.deepEqual(fresh.showing(), ["a", "b", null, null, null]);
  assert.equal(fresh.session.get().loading, false);
  const [a, b] = fresh.session.get().slots;

  fresh.answer(0, "cd");
  await quiet();
  assert.deepEqual(fresh.showing(), ["a", "b", "c", "d", null]);
  fresh.answer(1, "efg");
  await renewal;

  assert.deepEqual(fresh.showing(), ["a", "b", "c", "d", "e"]);
  assert.equal(fresh.session.get().slots[0], a);
  assert.equal(fresh.session.get().slots[1], b);
  assert.deepEqual(
    fresh.saved.offers.map((offer) => offer.id),
    [..."abcdefg"],
  );
});

test("a first radio with nothing eligible keeps loading until a later one has offers", async () => {
  const fresh = freshSuggestion(LETTERS, 2);
  const renewal = fresh.session.renew();
  fresh.answer(0, "");
  await quiet();
  assert.equal(fresh.session.get().loading, true);
  assert.equal(fresh.reports.length, 0);

  fresh.answer(1, "ab");
  await renewal;
  assert.equal(fresh.session.get().loading, false);
  assert.deepEqual(fresh.showing(), ["a", "b", null, null, null]);
  assert.equal(fresh.reports.length, 1);
});

test("only one radio answering shows its offers, whatever the others do", async () => {
  const fresh = freshSuggestion(LETTERS, 3);
  const renewal = fresh.session.renew();
  fresh.fail(0);
  fresh.noAnswer(1);
  await quiet();
  assert.equal(fresh.session.get().loading, true);
  assert.equal(fresh.session.get().error, null);

  fresh.answer(2, "abcde");
  await renewal;
  assert.deepEqual(fresh.showing(), ["a", "b", "c", "d", "e"]);
  assert.equal(fresh.session.get().error, null);
});

test("with no radio answering the failure line shows, and Try Again reads afresh", async () => {
  const fresh = freshSuggestion(LETTERS, 3);
  const renewal = fresh.session.renew();
  fresh.fail(0);
  fresh.noAnswer(1);
  await quiet();
  assert.equal(fresh.session.get().error, null);
  fresh.fail(2);
  await renewal;

  assert.equal(fresh.session.get().error, "load");
  assert.equal(fresh.session.get().loading, false);
  assert.deepEqual(fresh.ranks, []);
  assert.equal(fresh.reports[0]!.failed, true);
});

test("radios answering with nothing eligible make an empty section, not a failure", async () => {
  const fresh = freshSuggestion(LETTERS, 2);
  const renewal = fresh.session.renew();
  fresh.answer(0, "");
  fresh.noAnswer(1);
  await renewal;
  assert.equal(fresh.session.get().error, null);
  assert.equal(fresh.session.get().loading, false);
  assert.deepEqual(fresh.showing(), [null, null, null, null, null]);
});

test("offline, or with nothing to seed a radio, no radio answering isn't a failure: Library files can join", async () => {
  const song = { ...track("mine"), artists: ["Artist seed"] };
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      throw new Error("a fresh suggestion reads its radios one by one");
    },
    readFresh: async () => ({
      input: {
        playlist: [track("seed")],
        sources: { library: [song], pages: [], graph: null, online: false },
      },
      radios: [Promise.resolve(null)],
    }),
    dismiss: async () => {},
  });
  await session.renew();
  assert.equal(session.get().error, null);
  assert.equal(session.get().slots[0]?.track.id, "mine");

  const none = freshSuggestion(LETTERS, 0);
  await none.session.renew();
  assert.equal(none.session.get().error, null);
});

test("Add and Dismiss don't stop the later radios or wait for them, and the offer taken stays out", async () => {
  const fresh = freshSuggestion(LETTERS, 2);
  const renewal = fresh.session.renew();
  fresh.answer(0, "abcdef");
  await quiet();

  assert.equal(await fresh.session.dismiss(fresh.session.get().slots[0]!.key), true);
  assert.deepEqual(fresh.showing(), ["f", "b", "c", "d", "e"]);
  assert.equal(fresh.session.renewalOwed(), true);

  fresh.answer(1, "agh");
  await renewal;
  assert.deepEqual(
    fresh.saved.offers.map((offer) => offer.id),
    [..."bcdefgh"],
  );
  assert.deepEqual(fresh.showing(), ["f", "b", "c", "d", "e"]);
  assert.equal(fresh.session.renewalOwed(), false);
});

test("hiding the playlist stops the later radios, and a renewal is then owed behind the offers", async () => {
  const fresh = freshSuggestion(LETTERS, 2);
  const renewal = fresh.session.renew();
  fresh.answer(0, "abcde");
  await quiet();
  assert.equal(fresh.session.renewalOwed(), true);

  fresh.session.pause();
  await renewal;
  fresh.answer(1, "fgh");
  await quiet();
  assert.deepEqual(fresh.ranks, [["song:0"]]);
  assert.deepEqual(fresh.showing(), ["a", "b", "c", "d", "e"]);
  assert.equal(fresh.session.get().loading, false);
});

test("a full reserve doesn't rank a later radio that could add nothing", async () => {
  const fresh = freshSuggestion(LETTERS, 2);
  const renewal = fresh.session.renew();
  fresh.answer(0, "abcdefghijklmnopqrstuvwx");
  await quiet();
  assert.equal(fresh.saved.offers.length, 20);
  fresh.answer(1, "yz");
  await renewal;
  assert.deepEqual(fresh.ranks, [["song:0"]]);
});

test("a later ranking that fails costs only its spares", async () => {
  let rankings = 0;
  const answers = [
    Promise.withResolvers<RadioRankingPage | null>(),
    Promise.withResolvers<RadioRankingPage | null>(),
  ];
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => {
      throw new Error("a fresh suggestion reads its radios one by one");
    },
    readFresh: async () => ({
      input: { playlist: [track("seed")], sources: { library: LETTERS, pages: [], graph: null } },
      radios: answers.map((answer) => answer.promise),
    }),
    rank: async (input) => {
      if (++rankings > 1) throw new Error("rank failed");
      return playlistRecommendations(input.playlist, input.sources, 20);
    },
    dismiss: async () => {},
  });
  const renewal = session.renew();
  answers[0]!.resolve({ id: "song:0", artists: [], songs: [..."abcde"].map(track) });
  await quiet();
  answers[1]!.resolve({ id: "song:1", artists: [], songs: [..."fg"].map(track) });
  await renewal;
  assert.equal(session.get().error, null);
  assert.equal(session.get().slots[0]?.track.id, "a");
});
