import assert from "node:assert/strict";
import { test } from "node:test";
import { playlistRecommendationSession, type PlaylistRecommendationTrack } from "./index.ts";

const track = (id: string): PlaylistRecommendationTrack => ({id, source: "library", videoId: "", title: id, artists: ["Radiohead"], album: "OK Computer", albumId: null, durationMs: 180000, artworkUrl: null, explicit: false, genre: "Rock"});

test("dismissal saves once before replacing only its slot; failed saves keep the row and allow retry", async () => {
  const seed = track("seed");
  const library = [seed, ..."abcdefg".split("").map(track)];
  let release!: () => void;
  let fail = true;
  let saves = 0;
  let id = 0;
  const session = playlistRecommendationSession({
    newId: () => String(++id),
    read: async () => ({playlist: [seed], sources: {library, catalog: [], graph: null, now: 0}}),
    dismiss: async () => {saves++; await new Promise<void>(resolve => {release = resolve;}); if (fail) throw new Error("disk full");},
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
  assert.equal(session.get().slots.some(x => x?.track.id === offer.track.id), false);
  assert.equal(await session.dismiss(offer.key), false);
});
