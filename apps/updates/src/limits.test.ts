import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assetKey, latestApkKey, latestKey, notesHistoryKey, updateKey } from "./layout.ts";
import { type CountedRoute, DAILY_LIMITS, durableCounter } from "./limits.ts";
import { createUpdateService } from "./service.ts";
import { memoryCounts, memoryStorage } from "./testing.ts";
import * as worker from "./worker.ts";

const ORIGIN = "https://updates.test";
const ASSET = "ab".repeat(32);
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
  return storage;
};

const PATHS: Record<CountedRoute, string> = {
  manifest: "/v1/manifest",
  notes: "/v1/notes?channel=ti",
  apk: "/v1/apk?channel=ti",
  assets: `/v1/assets/${ASSET}`,
};

const setup = async (start = "2026-11-18T09:30:00.000Z") => {
  const counts = memoryCounts();
  let at = Date.parse(start);
  const service = createUpdateService(await bucket(), {
    counter: durableCounter(counts.namespace),
    now: () => at,
  });
  const ask = (route: CountedRoute, address: string | null = PHONE) =>
    service.fetch(
      new Request(`${ORIGIN}${PATHS[route]}`, {
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
  return { counts, ask, statuses, setNow: (iso: string) => (at = Date.parse(iso)) };
};

describe("an address's daily answers", () => {
  it("answers the manifest 3 times a day, then 'nothing new' until the next UTC midnight", async () => {
    const { ask, statuses } = await setup("2026-11-18T09:30:00.000Z");
    assert.deepEqual(await statuses("manifest", 3), [200, 200, 200]);
    const fourth = await ask("manifest");
    assert.equal(fourth.status, 204);
    // The protocol's own "nothing new", which expo-updates takes as a finished check.
    assert.equal(fourth.headers.get("expo-protocol-version"), "1");
    assert.equal(fourth.headers.get("retry-after"), String(14.5 * 60 * 60));
    assert.equal(await fourth.text(), "");
  });

  for (const route of ["notes", "apk"] as const) {
    it(`answers ${route} 3 times a day, then 429 until the next UTC midnight`, async () => {
      const { ask, statuses } = await setup("2026-11-18T23:59:00.000Z");
      assert.deepEqual(await statuses(route, 3), [200, 200, 200]);
      const fourth = await ask(route);
      assert.equal(fourth.status, 429);
      assert.equal(fourth.headers.get("retry-after"), "60");
    });
  }

  it("counts each address on its own", async () => {
    const { statuses } = await setup();
    assert.deepEqual(await statuses("notes", 4), [200, 200, 200, 429]);
    assert.deepEqual(await statuses("notes", 4, "198.51.100.20"), [200, 200, 200, 429]);
  });

  it("counts an IPv6 address by its /64, however it's written", async () => {
    const { statuses } = await setup();
    assert.deepEqual(await statuses("apk", 2, "2001:db8:0:1::1"), [200, 200]);
    assert.deepEqual(await statuses("apk", 2, "2001:0DB8:0000:0001:aaaa::9"), [200, 429]);
    assert.deepEqual(await statuses("apk", 1, "2001:db8:0:2::1"), [200]);
    // An IPv4 address written as IPv6 is that IPv4 address, not the all-zero block.
    assert.deepEqual(await statuses("apk", 3, "::ffff:192.0.2.1"), [200, 200, 200]);
    assert.deepEqual(await statuses("apk", 1, "192.0.2.1"), [429]);
    assert.deepEqual(await statuses("apk", 1, "::ffff:192.0.2.2"), [200]);
  });

  it("starts over on the next UTC day, and the day's counts are deleted when it ends", async () => {
    const { counts, statuses, setNow } = await setup("2026-11-18T23:00:00.000Z");
    assert.deepEqual(await statuses("manifest", 4), [200, 200, 200, 204]);
    assert.deepEqual(await statuses("apk", 4), [200, 200, 200, 429]);
    setNow("2026-11-19T00:00:00.000Z");
    assert.equal(counts.stored(), 2);
    await counts.runAlarms(Date.parse("2026-11-19T00:00:00.000Z"));
    assert.equal(counts.stored(), 0);
    assert.deepEqual(await statuses("manifest", 4), [200, 200, 200, 204]);
    assert.deepEqual(await statuses("apk", 4), [200, 200, 200, 429]);
  });

  it("starts over on the next day even before the old day's counts are deleted", async () => {
    const { statuses, setNow } = await setup("2026-11-18T23:00:00.000Z");
    assert.deepEqual(await statuses("notes", 4), [200, 200, 200, 429]);
    setNow("2026-11-19T00:00:01.000Z");
    assert.deepEqual(await statuses("notes", 4), [200, 200, 200, 429]);
  });

  it("counts each route on its own", async () => {
    const { statuses } = await setup();
    assert.deepEqual(await statuses("manifest", 4), [200, 200, 200, 204]);
    assert.deepEqual(await statuses("notes", 4), [200, 200, 200, 429]);
    assert.deepEqual(await statuses("apk", 4), [200, 200, 200, 429]);
    assert.deepEqual(await statuses("assets", 3), [200, 200, 200]);
  });

  it("serves an update's assets far past 3, up to their own bound", async () => {
    const { statuses } = await setup();
    const answers = await statuses("assets", DAILY_LIMITS.assets + 1);
    assert.equal(DAILY_LIMITS.assets >= 500, true);
    assert.deepEqual(new Set(answers.slice(0, -1)), new Set([200]));
    assert.equal(answers.at(-1), 429);
    // Reaching it leaves the other routes alone.
    assert.deepEqual(await statuses("manifest", 1), [200]);
  });

  it("asks the counts nothing more once it has refused an address for the day", async () => {
    const { counts, statuses } = await setup();
    await statuses("notes", 4);
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
    assert.deepEqual(await statuses("apk", 5, null), [200, 200, 200, 200, 200]);
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
