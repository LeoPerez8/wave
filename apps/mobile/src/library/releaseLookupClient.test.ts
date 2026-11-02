import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseLookupClient } from "./releaseLookupClient.ts";
test("paces, splits saturated batches, and pages a single ISRC", async () => {
  let now = 0;
  const calls: { url: string; at: number }[] = [];
  const client = releaseLookupClient(
    async (url) => {
      calls.push({ url, at: now });
      const query = new URL(url).searchParams;
      const count = query.get("query")?.includes(" OR ") || query.get("offset") === "0" ? 101 : 1;
      return { status: 200, json: async () => ({ count, recordings: [] }) };
    },
    async (ms) => {
      now += ms;
    },
    () => now,
  );
  await client.recordings(["USABC0000001", "USABC0000002"]);
  assert.equal(calls.length, 5);
  assert.ok(calls.slice(1).every((c, i) => c.at - calls[i]!.at >= 1000));
  assert.equal(new URL(calls[2]!.url).searchParams.get("offset"), "100");
});

test("concurrent callers still share one host allowance and send an identifying User-Agent", async () => {
  let now = 0;
  const starts: number[] = [];
  const client = releaseLookupClient(
    async (_url, headers) => {
      starts.push(now);
      assert.match(headers["User-Agent"]!, /Wave.*github.com\/LeoPerez8\/wave/);
      return { status: 200, json: async () => ({ count: 0, recordings: [] }) };
    },
    async (ms) => {
      now += ms;
    },
    () => now,
  );
  await Promise.all([client.recordings(["USABC0000001"]), client.recordings(["USABC0000002"])]);
  assert.ok(starts[1]! - starts[0]! >= 1000);
});

test("oversized queries split, refusals fail without poisoning the queue, paused work sends nothing", async () => {
  let calls = 0;
  let active = true;
  const client = releaseLookupClient(
    async (url) => {
      calls++;
      const q = new URL(url).searchParams.get("query") ?? "";
      return {
        status: q.includes(" OR ") ? 414 : 200,
        json: async () => ({ count: 0, recordings: [] }),
      };
    },
    async () => {},
    Date.now,
    () => active,
  );
  await client.recordings(["USABC0000001", "USABC0000002"]);
  assert.equal(calls, 3);
  active = false;
  await assert.rejects(client.search("Song", "Artist"), /paused/);
  assert.equal(calls, 3);
  let refused = true;
  const retry = releaseLookupClient(
    async () => ({ status: refused ? 429 : 200, json: async () => ({ data: [] }) }),
    async () => {},
  );
  await assert.rejects(retry.search("Song", "Artist"), /429/);
  refused = false;
  assert.deepEqual(await retry.search("Song", "Artist"), { data: [] });
});
