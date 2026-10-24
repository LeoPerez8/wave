import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completeMagicRadioBatch,
  magicRadioReadPlan,
  magicArtistKey,
  startMagicQueue,
  type RankedRadioSong,
} from "./index.ts";

const candidate = (id: string, source: "library" | "stream" = "stream"): RankedRadioSong => ({
  trackId: source === "library" ? id : `yt:${id}`,
  artists: [magicArtistKey(id)],
  genre: null,
  style: null,
  source,
  score: 10,
  radio: { id: "radio", position: 0 },
  song: {
    videoId: id,
    title: id,
    artists: [id],
    album: null,
    albumId: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  },
});

test("radio reads account for batch size, learned quota and each pool's stream shortage", () => {
  const streams = Array.from({ length: 12 }, (_, n) => candidate(`s${n}`));
  const files = Array.from({ length: 12 }, (_, n) => candidate(`l${n}`, "library"));
  const session = started();
  assert.deepEqual(magicRadioReadPlan(session, streams, streams, true), {
    size: 9,
    likedQuota: 3,
    seedLow: false,
    likedLow: false,
  });
  assert.equal(
    magicRadioReadPlan({ ...session, batches: 1 }, streams.slice(0, 9), [], false).seedLow,
    true,
  );
  assert.equal(magicRadioReadPlan(session, files, streams, true).seedLow, true);
  assert.equal(magicRadioReadPlan(session, streams, files, true).likedLow, true);
  assert.equal(
    magicRadioReadPlan(session, streams.slice(0, 4), streams.slice(0, 4), true).likedLow,
    true,
  );
  assert.deepEqual(magicRadioReadPlan(session, streams, [], false), {
    size: 9,
    likedQuota: 0,
    seedLow: false,
    likedLow: false,
  });
});
const started = () =>
  startMagicQueue(
    { kind: "track", id: "seed", title: "seed" },
    [{ trackId: "seed", artists: [magicArtistKey("Seed")], genre: null, style: null }],
    { id: "session", random: () => 0, ytShare: 0.6 },
  )!.session;

test("completing a batch records queue ids and video aliases, preserves learning and advances once", () => {
  const session = { ...started(), used: ["seed", "yt:used"], seedDraws: ["drawn"] };
  const original = Array.from({ length: 12 }, (_, n) =>
    candidate(String(n), n < 4 ? "library" : "stream"),
  );
  const liked = [
    candidate("liked1"),
    candidate("liked2"),
    candidate("liked3"),
    candidate("used", "library"),
  ];
  const batch = completeMagicRadioBatch(session, original, liked);
  assert.equal(batch.trackIds.length, 9);
  assert.equal(batch.trackIds.filter((id) => id.startsWith("yt:liked")).length, 3);
  assert.ok(!batch.trackIds.includes("used"));
  assert.equal(batch.session.batches, 1);
  assert.deepEqual(batch.session.seedDraws, ["drawn"]);
  assert.ok(batch.session.used.includes("0"));
  assert.ok(batch.session.used.includes("yt:0"));
  assert.equal(new Set(batch.session.used).size, batch.session.used.length);
  assert.deepEqual(session.used, ["seed", "yt:used"]);
  const next = completeMagicRadioBatch(
    batch.session,
    Array.from({ length: 15 }, (_, n) => candidate(`next${n}`)),
    [],
  );
  assert.equal(next.trackIds.length, 10);
  assert.equal(next.session.batches, 2);
  const empty = completeMagicRadioBatch(session, [candidate("used")], []);
  assert.deepEqual(empty.trackIds, []);
  assert.equal(empty.session, session);
});
