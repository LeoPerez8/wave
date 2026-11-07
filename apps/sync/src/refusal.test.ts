import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { SYNC_LIMITS } from "./limits.ts";
import { serviceMemory } from "./service.ts";
import { harness } from "./testing.ts";

describe("requests refused before the database", () => {
  test("a token that isn't the shape sign-in gives answers 401 with no query", async () => {
    const service = await harness();
    const before = service.queries();
    for (const session of ["made-up", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}!`]) {
      const response = await service.request("GET", "/v1/pull", { session });
      assert.equal(response.status, 401, session);
      assert.deepEqual(await response.json(), { error: "unauthorized" });
    }
    assert.equal(service.queries(), before);
  });

  test("a token of the right shape that names no session is looked up", async () => {
    const service = await harness();
    const before = service.queries();
    const response = await service.request("GET", "/v1/pull", { session: "a".repeat(43) });
    assert.equal(response.status, 401);
    assert.equal(service.queries(), before + 1);
  });
});

describe("the per-address limit on every request", () => {
  test("past maxRequestsPerAddressPerMinute, an address answers 429 with no query until the next minute", async () => {
    const service = await harness({ limits: { maxRequestsPerAddressPerMinute: 3 } });
    const session = await service.signIn();
    const pullFrom = (address: string) =>
      service.request("GET", "/v1/pull", { session, headers: { "cf-connecting-ip": address } });
    for (let i = 0; i < 3; i++) assert.equal((await pullFrom("203.0.113.7")).status, 200);

    const before = service.queries();
    const refused = await pullFrom("203.0.113.7");
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), {
      error: "limit",
      limit: "maxRequestsPerAddressPerMinute",
    });
    assert.ok(Number(refused.headers.get("retry-after")) > 0);
    const signIn = await service.request("POST", "/v1/session", {
      json: { idToken: await service.google.idToken() },
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });
    assert.equal(signIn.status, 429);
    assert.equal(service.queries(), before);

    assert.equal((await pullFrom("203.0.113.8")).status, 200);
    service.now += 60_000;
    assert.equal((await pullFrom("203.0.113.7")).status, 200);
  });
});

/** A token of the shape sign-in gives that names no session. */
const unknownToken = (): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

describe("the per-address limit on failed session lookups", () => {
  test("past it, an address runs no session lookup for failedLookupBlockSeconds, and other addresses keep working", async () => {
    const service = await harness({
      limits: { maxFailedLookupsPerAddressPerMinute: 2, failedLookupBlockSeconds: 120 },
    });
    const session = await service.signIn();
    const from = (address: string, token: string) =>
      service.request("GET", "/v1/pull", {
        session: token,
        headers: { "cf-connecting-ip": address },
      });
    const attacker = "203.0.113.7";
    for (let i = 0; i < 3; i++) assert.equal((await from(attacker, unknownToken())).status, 401);

    const before = service.queries();
    for (const token of [unknownToken(), session]) {
      const held = await from(attacker, token);
      assert.equal(held.status, 429);
      assert.deepEqual(await held.json(), {
        error: "limit",
        limit: "maxFailedLookupsPerAddressPerMinute",
      });
      assert.equal(held.headers.get("retry-after"), "120");
    }
    assert.equal(service.queries(), before);

    assert.equal((await from("198.51.100.4", session)).status, 200);

    service.now += 60_000;
    assert.equal((await from(attacker, session)).status, 429);
    service.now += 60_000;
    assert.equal((await from(attacker, session)).status, 200);
  });

  test("the hold lasts across services built over the same memory, as the Worker builds one per request", async () => {
    const memory = serviceMemory();
    const limits = { maxFailedLookupsPerAddressPerMinute: 1 };
    const first = await harness({ limits, memory });
    const headers = { "cf-connecting-ip": "203.0.113.7" };
    for (let i = 0; i < 2; i++) {
      await first.request("GET", "/v1/pull", { session: unknownToken(), headers });
    }
    const second = await harness({ limits, memory }, first.db);
    const held = await second.request("GET", "/v1/pull", { session: unknownToken(), headers });
    assert.equal(held.status, 429);
    assert.equal(second.queries(), 0);
  });

  test("a valid session's requests never count toward it", async () => {
    const service = await harness({ limits: { maxFailedLookupsPerAddressPerMinute: 1 } });
    const session = await service.signIn();
    const from = (token: string) =>
      service.request("GET", "/v1/pull", {
        session: token,
        headers: { "cf-connecting-ip": "203.0.113.7" },
      });
    for (let i = 0; i < 10; i++) assert.equal((await from(session)).status, 200);
    assert.equal((await from(unknownToken())).status, 401);
    assert.equal((await from(session)).status, 200);
  });

  test("a token that isn't the issued shape doesn't count toward it either", async () => {
    const service = await harness({ limits: { maxFailedLookupsPerAddressPerMinute: 1 } });
    const session = await service.signIn();
    const from = (token: string) =>
      service.request("GET", "/v1/pull", {
        session: token,
        headers: { "cf-connecting-ip": "203.0.113.7" },
      });
    for (let i = 0; i < 5; i++) assert.equal((await from("made-up")).status, 401);
    assert.equal((await from(session)).status, 200);
  });
});

describe("the refusal log", () => {
  test("counts refused requests at most once a minute, never naming a token or an address", async () => {
    const service = await harness({ limits: { maxFailedLookupsPerAddressPerMinute: 2 } });
    const address = "203.0.113.7";
    const tokens = ["made-up", unknownToken(), unknownToken(), unknownToken(), unknownToken()];
    const from = (token: string) =>
      service.request("GET", "/v1/pull", {
        session: token,
        headers: { "cf-connecting-ip": address },
      });

    await from(tokens[0]!);
    assert.deepEqual(service.logs, ["sync service refused requests: malformed_token=1"]);
    for (const token of tokens.slice(1, 4)) await from(token);
    assert.equal(service.logs.length, 1);
    service.now += 60_000;
    await from(tokens[4]!);
    assert.deepEqual(service.logs.slice(1), [
      "sync service refused requests: unknown_session=3, held_address=1",
    ]);
    for (const line of service.logs) {
      assert.ok(!line.includes(address));
      for (const token of tokens) assert.ok(!line.includes(token));
    }
  });

  test("counts requests past the per-address limit", async () => {
    const service = await harness({ limits: { maxRequestsPerAddressPerMinute: 1 } });
    const headers = { "cf-connecting-ip": "203.0.113.7" };
    assert.equal((await service.request("GET", "/v1/elsewhere", { headers })).status, 404);
    assert.equal((await service.request("GET", "/v1/elsewhere", { headers })).status, 429);
    assert.deepEqual(service.logs, ["sync service refused requests: address_limit=1"]);
  });
});

describe("the Worker's rate limiting bindings", () => {
  const wrangler = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  /** Every `[[ratelimits]]` binding: its name, namespace and `simple` limit and period. */
  const bindings = wrangler
    .split("[[ratelimits]]")
    .slice(1)
    .map((block) => ({
      name: /name = "([A-Z_]+)"/.exec(block)?.[1],
      namespace: /namespace_id = "(\d+)"/.exec(block)?.[1],
      simple: /simple = \{ limit = (\d+), period = (\d+) \}/.exec(block)?.slice(1).map(Number),
    }));

  test("count per minute what SYNC_LIMITS says, every one of them", () => {
    assert.deepEqual(
      Object.fromEntries(bindings.map((binding) => [binding.name, binding.simple])),
      {
        ADDRESS_LIMITER: [SYNC_LIMITS.maxRequestsPerAddressPerMinute, 60],
        FAILED_LOOKUP_LIMITER: [SYNC_LIMITS.maxFailedLookupsPerAddressPerMinute, 60],
        GENIUS_LIMITER: [SYNC_LIMITS.maxGeniusRequestsPerMinute, 60],
        TICKETMASTER_LIMITER: [SYNC_LIMITS.maxTicketmasterRequestsPerMinute, 60],
      },
    );
  });

  test("each has its own namespace", () => {
    const namespaces = bindings.map((binding) => binding.namespace);
    assert.ok(namespaces.every((namespace) => namespace !== undefined));
    assert.equal(new Set(namespaces).size, namespaces.length);
  });
});
