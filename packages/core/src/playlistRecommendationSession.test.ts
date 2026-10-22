import assert from "node:assert/strict";
import { test } from "node:test";
import {
  playlistRecommendationSession,
  type PlaylistRecommendationFeedback,
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
  await session.renew({ ifPlaylistChanged: true });
  assert.deepEqual(
    session.get().slots.flatMap((offer) => offer ?? []),
    [],
  );
  assert.equal(session.get().error, null);
});

test("an acceptance membership notification preserves the four held offers; a later external edit renews priority", async () => {
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
  const refilled = session.get().slots;
  // The screen receives the membership notification after the action's fresh read.
  await session.renew({ ifPlaylistChanged: true });
  for (const index of [0, 1, 3, 4]) assert.equal(session.get().slots[index], before[index]);
  assert.equal(session.get().slots[2], refilled[2]);
  playlist = [...playlist, track("external")];
  await session.renew({ ifPlaylistChanged: true });
  assert.deepEqual(
    session
      .get()
      .slots.flatMap((offer) => offer?.track.id ?? [])
      .toSorted(),
    ["a", "b", "d", "g", "h"],
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
