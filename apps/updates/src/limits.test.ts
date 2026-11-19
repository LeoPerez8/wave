import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assetKey, latestApkKey, latestKey, notesHistoryKey, updateKey } from "./layout.ts";
import {
  type CountedRoute,
  DAILY_LIMITS,
  DAILY_LIMIT_PER_ASSET,
  durableCounter,
} from "./limits.ts";
import { createUpdateService } from "./service.ts";
import { memoryCounts, memoryStorage } from "./testing.ts";
import * as worker from "./worker.ts";

const ORIGIN = "https://updates.test";
const ASSET = "ab".repeat(32);
/** Another asset's name, by number. */
const assetNamed = (index: number): string => index.toString(16).padStart(64, "0");
const PHONE = "203.0.113.7";

/** A bucket with something behind every route: an update, notes, an APK and an asset. */
const bucket = async () => {
  const storage = memoryStorage();
  const json = { httpMetadata: { contentType: "application/json" } };
  await storage.put(latestKey("ti", "native-a"), JSON.stringify({ updateId: "u1" }), json);
  await storage.put(
    updateKey("ti", "native-a", "u1"),
    JSON.stringify({ id: "u1", signed: { manifest: "{}", signature: 'sig="a"' } }),
    json,
  );
  await storage.put(notesHistoryKey("ti"), "[]", json);
  await storage.put(latestApkKey("ti"), JSON.stringify({ metadata: "{}", signature: "s" }), json);
  await storage.put(assetKey(ASSET), "bytes", "image/png");
  for (let index = 0; index <= DAILY_LIMITS.assets; index += 1) {
    await storage.put(assetKey(assetNamed(index)), "bytes", "image/png");
  }
  return storage;
};

const PATHS: Record<CountedRoute, string> = {
  manifest: "/v1/manifest",
  notes: "/v1/notes?channel=ti",
  apk: "/v1/apk?channel=ti",
  assets: `/v1/assets/${ASSET}`,
  desktop: "/v1/desktop/ti/latest.json",
  "desktop-file": `/v1/desktop/ti/files/0.71.0-ti/${"a".repeat(128)}/wave-0.71.0-ti-win-x64.exe`,
};

const setup = async (start = "2026-11-18T09:30:00.000Z") => {
  const counts = memoryCounts();
  let at = Date.parse(start);
  const service = createUpdateService(await bucket(), {
    counter: durableCounter(counts.namespace),
    now: () => at,
  });
  const ask = (route: CountedRoute, address: string | null = PHONE, path = PATHS[route]) =>
    service.fetch(
      new Request(`${ORIGIN}${path}`, {
        headers: {
          "expo-protocol-version": "1",
          "expo-platform": "android",
          "expo-channel-name": "ti",
          "expo-runtime-version": "native-a",
          ...(address === null ? {} : { "cf-connecting-ip": address }),
        },
      }),
    );
  const statuses = async (route: CountedRoute, times: number, address?: string | null) => {
    const answers: number[] = [];
    for (let i = 0; i < times; i += 1) answers.push((await ask(route, address)).status);
    return answers;
  };
  /** Asks `route` until its day's answers are used up, and says what the one after them got. */
  const pastLimit = async (route: CountedRoute, address?: string | null) => {
    const within = await statuses(route, DAILY_LIMITS[route], address);
    assert.deepEqual(new Set(within), new Set([200]));
    return ask(route, address);
  };
  const asset = (name: string, address: string | null = PHONE) =>
    ask("assets", address, `/v1/assets/${name}`);
  return {
    counts,
    ask,
    asset,
    statuses,
    pastLimit,
    setNow: (iso: string) => (at = Date.parse(iso)),
  };
};

describe("an address's daily answers", () => {
  it("answers the manifest its day's times, then 'nothing new' until the next UTC midnight", async () => {
    const { pastLimit } = await setup("2026-11-18T09:30:00.000Z");
    const next = await pastLimit("manifest");
    assert.equal(next.status, 204);
    // The protocol's own "nothing new", which expo-updates takes as a finished check.
    assert.equal(next.headers.get("expo-protocol-version"), "1");
    assert.equal(next.headers.get("retry-after"), String(14.5 * 60 * 60));
    assert.equal(await next.text(), "");
  });

  for (const route of ["notes", "apk"] as const) {
    it(`answers ${route} its day's times, then 429 until the next UTC midnight`, async () => {
      const { pastLimit } = await setup("2026-11-18T23:59:00.000Z");
      const next = await pastLimit(route);
      assert.equal(next.status, 429);
      assert.equal(next.headers.get("retry-after"), "60");
    });
  }

  it("lets a phone check every 15 minutes all day", () => {
    assert.equal(DAILY_LIMITS.manifest >= 96, true);
    assert.equal(DAILY_LIMITS.apk >= 96, true);
  });

  it("counts each address on its own", async () => {
    const { pastLimit } = await setup();
    assert.equal((await pastLimit("notes")).status, 429);
    assert.equal((await pastLimit("notes", "198.51.100.20")).status, 429);
  });

  it("counts an IPv6 address by its /64, however it's written", async () => {
    const { asset } = await setup();
    const got = async (address: string) => (await asset(ASSET, address)).status;
    for (let i = 1; i < DAILY_LIMIT_PER_ASSET; i += 1) {
      assert.equal(await got("2001:db8:0:1::1"), 200);
    }
    assert.equal(await got("2001:0DB8:0000:0001:aaaa::9"), 200);
    assert.equal(await got("2001:db8:0:1:bbbb::2"), 429);
    assert.equal(await got("2001:db8:0:2::1"), 200);
    // An IPv4 address written as IPv6 is that IPv4 address, not the all-zero block.
    for (let i = 0; i < DAILY_LIMIT_PER_ASSET; i += 1) {
      assert.equal(await got("::ffff:192.0.2.1"), 200);
    }
    assert.equal(await got("192.0.2.1"), 429);
    assert.equal(await got("::ffff:192.0.2.2"), 200);
  });

  it("starts over on the next UTC day, and the day's counts are deleted when it ends", async () => {
    const { counts, pastLimit, setNow } = await setup("2026-11-18T23:00:00.000Z");
    assert.equal((await pastLimit("manifest")).status, 204);
    assert.equal((await pastLimit("apk")).status, 429);
    setNow("2026-11-19T00:00:00.000Z");
    assert.equal(counts.stored(), 2);
    await counts.runAlarms(Date.parse("2026-11-19T00:00:00.000Z"));
    assert.equal(counts.stored(), 0);
    assert.equal((await pastLimit("manifest")).status, 204);
    assert.equal((await pastLimit("apk")).status, 429);
  });

  it("starts over on the next day even before the old day's counts are deleted", async () => {
    const { pastLimit, setNow } = await setup("2026-11-18T23:00:00.000Z");
    assert.equal((await pastLimit("notes")).status, 429);
    setNow("2026-11-19T00:00:01.000Z");
    assert.equal((await pastLimit("notes")).status, 429);
  });

  it("counts each route on its own", async () => {
    const { pastLimit, statuses } = await setup();
    assert.equal((await pastLimit("notes")).status, 429);
    assert.deepEqual(await statuses("manifest", 1), [200]);
    assert.deepEqual(await statuses("apk", 1), [200]);
    assert.deepEqual(await statuses("assets", 1), [200]);
  });

  it("gives an address the same asset only a few times a day", async () => {
    const { asset, setNow } = await setup("2026-11-18T23:00:00.000Z");
    for (let i = 0; i < DAILY_LIMIT_PER_ASSET; i += 1) {
      assert.equal((await asset(ASSET)).status, 200);
    }
    const next = await asset(ASSET);
    assert.equal(next.status, 429);
    assert.equal(next.headers.get("retry-after"), "3600");
    // Another asset, and the same one for another address, are still answered.
    assert.equal((await asset(assetNamed(1))).status, 200);
    assert.equal((await asset(ASSET, "198.51.100.20")).status, 200);
    setNow("2026-11-19T00:00:01.000Z");
    assert.equal((await asset(ASSET)).status, 200);
  });

  it("serves an update's files, each a different asset, up to the day's number", async () => {
    const { asset, statuses } = await setup();
    assert.equal(DAILY_LIMITS.assets >= 20, true);
    for (let index = 0; index < DAILY_LIMITS.assets; index += 1) {
      assert.equal((await asset(assetNamed(index))).status, 200);
    }
    assert.equal((await asset(assetNamed(DAILY_LIMITS.assets))).status, 429);
    // Reaching it leaves the other routes alone.
    assert.deepEqual(await statuses("manifest", 1), [200]);
  });

  it("keeps nothing more for an address past its day's assets, whatever it asks for", async () => {
    const { counts, asset } = await setup();
    for (let index = 0; index < DAILY_LIMITS.assets; index += 1) await asset(assetNamed(index));
    assert.equal((await asset(assetNamed(1000))).status, 429);
    const stored = counts.stored();
    const calls = counts.calls();
    for (let index = 1001; index < 1050; index += 1) {
      assert.equal((await asset(assetNamed(index))).status, 429);
    }
    assert.equal(counts.stored(), stored);
    assert.equal(counts.calls(), calls);
  });

  it("asks the counts nothing more once it has refused an address for the day", async () => {
    const { counts, pastLimit, statuses } = await setup();
    await pastLimit("notes");
    const after = counts.calls();
    assert.deepEqual(await statuses("notes", 5), [429, 429, 429, 429, 429]);
    assert.equal(counts.calls(), after);
  });

  it("keeps no address, only its SHA-256", async () => {
    const { counts, statuses } = await setup();
    await statuses("manifest", 1);
    await statuses("manifest", 1, "2001:db8:0:1::1");
    const held = counts.held();
    for (const text of [PHONE, "2001:db8", "203.0.113"]) assert.equal(held.includes(text), false);
    assert.match(held, /"[0-9a-f]{64}"/);
  });

  it("counts nothing without an address, which only the tests leave out", async () => {
    const { counts, statuses } = await setup();
    const times = DAILY_LIMIT_PER_ASSET + 2;
    assert.deepEqual(await statuses("assets", times, null), Array(times).fill(200));
    assert.equal(counts.calls(), 0);
  });

  it("answers when the counts can't be reached, as what it serves is public", async () => {
    const service = createUpdateService(await bucket(), {
      counter: {
        count: async () => {
          throw new Error("unreachable");
        },
      },
    });
    const errors = console.error;
    const logged: unknown[][] = [];
    console.error = (...line: unknown[]) => void logged.push(line);
    try {
      for (let i = 0; i < 5; i += 1) {
        const answer = await service.fetch(
          new Request(`${ORIGIN}${PATHS.notes}`, { headers: { "cf-connecting-ip": PHONE } }),
        );
        assert.equal(answer.status, 200);
      }
    } finally {
      console.error = errors;
    }
    assert.equal(logged.length, 5);
    assert.equal(JSON.stringify(logged).includes(PHONE), false);
  });

  it("counts nothing for a path that isn't a route, or a method it refuses", async () => {
    const { counts, ask } = await setup();
    const service = createUpdateService(await bucket(), {
      counter: durableCounter(counts.namespace),
    });
    const headers = { "cf-connecting-ip": PHONE };
    assert.equal((await service.fetch(new Request(`${ORIGIN}/v1/other`, { headers }))).status, 404);
    const post = new Request(`${ORIGIN}/v1/notes?channel=ti`, { method: "POST", headers });
    assert.equal((await service.fetch(post)).status, 405);
    assert.equal(counts.calls(), 0);
    assert.equal((await ask("notes")).status, 200);
  });
});

describe("the Worker's counts", () => {
  it("are the Durable Object wrangler.toml declares, with a migration a deploy applies", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    assert.match(toml, /name = "REQUEST_COUNTS"\s+class_name = "RequestCounts"/);
    // SQLite-backed, the kind Workers Free allows.
    assert.match(toml, /new_sqlite_classes = \["RequestCounts"\]/);
    assert.equal(typeof worker.RequestCounts, "function");
  });
});
