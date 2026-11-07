import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SYNC_LIMITS } from "./limits.ts";
import { TICKETMASTER_KEY, harness } from "./testing.ts";

const HOUR_MS = 60 * 60 * 1000;

const ATTRACTIONS = "/v1/ticketmaster/attractions?keyword=Coldplay";
const EVENTS = "/v1/ticketmaster/events?attractionId=K8vZ917_XCf&countryCode=BR";

/** A Ticketmaster attractions reply with one music attraction. */
const attractionsReply = {
  _embedded: {
    attractions: [
      {
        id: "K8vZ917_XCf",
        name: "Coldplay",
        classifications: [{ segment: { name: "Music" } }],
      },
    ],
  },
  page: { totalElements: 1 },
};

/** Ticketmaster's over-quota answer, which names the key. */
const overQuota = (): Response =>
  Response.json(
    {
      fault: {
        faultstring: `Rate limit quota violation. Quota limit exceeded. Identifier : ${TICKETMASTER_KEY}`,
        detail: { errorcode: "policies.ratelimit.QuotaViolation" },
      },
    },
    { status: 429, headers: { "rate-limit-over": "1" } },
  );

describe("Ticketmaster through the sync service", () => {
  test("without a session, a show check's request answers 401 and Ticketmaster is never asked", async () => {
    const service = await harness();
    for (const session of [undefined, "a".repeat(43)]) {
      for (const path of [ATTRACTIONS, EVENTS]) {
        const response = await service.request(
          "GET",
          path,
          session === undefined ? {} : { session },
        );
        assert.equal(response.status, 401, path);
      }
    }
    assert.deepEqual(service.upstream.calls, []);
  });

  test("with a session, the attraction search and the events are asked with the Worker's key", async () => {
    const service = await harness();
    const session = await service.signIn();
    service.upstream.answer = () => Response.json(attractionsReply);
    const response = await service.request("GET", ATTRACTIONS, { session });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), attractionsReply);
    assert.equal((await service.request("GET", EVENTS, { session })).status, 200);
    assert.deepEqual(
      service.upstream.calls.map((call) => call.url),
      [
        `https://app.ticketmaster.com/discovery/v2/attractions.json?keyword=Coldplay&classificationName=music&size=200&apikey=${TICKETMASTER_KEY}`,
        `https://app.ticketmaster.com/discovery/v2/events.json?attractionId=K8vZ917_XCf&countryCode=BR&sort=date%2Casc&size=200&apikey=${TICKETMASTER_KEY}`,
      ],
    );
    assert.match(service.upstream.calls[0]?.headers.get("user-agent") ?? "", /^Wave /);
  });

  test("a request that isn't one of the fixed ones never reaches Ticketmaster", async () => {
    const service = await harness();
    const session = await service.signIn();
    for (const path of [
      "/v1/ticketmaster/attractions",
      "/v1/ticketmaster/attractions?keyword=%20",
      "/v1/ticketmaster/attractions?keyword=a&apikey=x",
      "/v1/ticketmaster/attractions?keyword=a&size=1",
      "/v1/ticketmaster/events?attractionId=K1",
      "/v1/ticketmaster/events?attractionId=K1%2F..%2Fvenues&countryCode=BR",
      "/v1/ticketmaster/events?attractionId=K1&countryCode=BR&apikey=x",
    ]) {
      const response = await service.request("GET", path, { session });
      assert.equal(response.status, 400, path);
      assert.deepEqual(await response.json(), { error: "bad_request" }, path);
    }
    for (const path of [
      "/v1/ticketmaster/venues?id=1",
      "/v1/ticketmaster/events/K1",
      "/v1/ticketmaster/../ticketmaster/venues?id=1",
      "/v1/ticketmaster/events%2F..%2Fvenues?id=1",
      "/v1/ticketmaster",
    ]) {
      assert.equal((await service.request("GET", path, { session })).status, 404, path);
    }
    assert.equal((await service.request("POST", EVENTS, { session })).status, 404);
    assert.deepEqual(service.upstream.calls, []);
  });
});

describe("Ticketmaster's answers, cached for every account", () => {
  test("a second account asking about the same artist gets the answer with no request to Ticketmaster", async () => {
    const service = await harness();
    const ana = await service.signIn();
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    for (const session of [ana, bo]) {
      assert.equal((await service.request("GET", EVENTS, { session })).status, 200);
    }
    assert.equal(service.upstream.calls.length, 1);
    await service.request(
      "GET",
      "/v1/ticketmaster/events?attractionId=K8vZ917_XCf&countryCode=PT",
      { session: bo },
    );
    assert.equal(service.upstream.calls.length, 2);
  });

  test("an answer is kept for 12 hours, the Home check's cadence, then asked again", async () => {
    const service = await harness();
    const session = await service.signIn();
    const ask = () => service.request("GET", EVENTS, { session });
    await ask();
    service.now += 12 * HOUR_MS - 60_000;
    await ask();
    assert.equal(service.upstream.calls.length, 1);
    service.now += 60_000;
    await ask();
    assert.equal(service.upstream.calls.length, 2);
  });
});

describe("the pace of Ticketmaster's requests", () => {
  test("requests Ticketmaster answers start at least 250 ms apart, however many phones ask at once", async () => {
    const service = await harness();
    const session = await service.signIn();
    const responses = await Promise.all(
      ["K1", "K2", "K3", "K4"].map((id) =>
        service.request("GET", `/v1/ticketmaster/events?attractionId=${id}&countryCode=BR`, {
          session,
        }),
      ),
    );
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200, 200, 200],
    );
    const starts = service.upstream.calls.map((call) => call.at);
    assert.equal(starts.length, 4);
    for (let i = 1; i < starts.length; i++) {
      assert.ok((starts[i] ?? 0) - (starts[i - 1] ?? 0) >= 250, String(starts));
    }
  });

  test("a cached answer never waits its turn", async () => {
    const service = await harness();
    const session = await service.signIn();
    await service.request("GET", EVENTS, { session });
    const before = service.now;
    await service.request("GET", EVENTS, { session });
    assert.equal(service.now, before);
  });

  test("with too many requests waiting, one more answers 503 and asks nobody", async () => {
    const service = await harness();
    const session = await service.signIn();
    // Every request takes its turn at the same moment: 5 s of turns, 250 ms apart, fit 21.
    service.wait = () => new Promise((resolve) => setTimeout(resolve, 0));
    const answers = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        service.request("GET", `/v1/ticketmaster/events?attractionId=K${i}&countryCode=BR`, {
          session,
        }),
      ),
    );
    const busy = answers.filter((response) => response.status === 503);
    assert.equal(busy.length, 9);
    for (const response of busy) assert.deepEqual(await response.json(), { error: "busy" });
    assert.equal(service.upstream.calls.length, 21);
  });
});

describe("Ticketmaster's failures", () => {
  test("an error from Ticketmaster answers 502 with none of its body, and isn't kept", async () => {
    const service = await harness();
    const session = await service.signIn();
    for (const answer of [
      overQuota,
      () =>
        Response.json(
          {
            fault: {
              faultstring: "Spike arrest violation",
              detail: { errorcode: "policies.ratelimit.SpikeArrestViolation" },
            },
          },
          { status: 429, headers: { "rate-limit": "5" } },
        ),
      () => new Response(`Unauthorized ${encodeURIComponent(TICKETMASTER_KEY)}`, { status: 401 }),
      () =>
        Response.json({ _links: { self: { href: `/events.json?apikey=${TICKETMASTER_KEY}` } } }),
      () => Promise.reject(new Error(`network down for ${TICKETMASTER_KEY}`)),
    ]) {
      service.upstream.answer = answer;
      const response = await service.request("GET", EVENTS, { session });
      assert.equal(response.status, 502);
      const text = await response.text();
      assert.deepEqual(JSON.parse(text), { error: "upstream_failed" });
      assert.ok(!text.includes(TICKETMASTER_KEY));
      for (const [, value] of response.headers) assert.ok(!value.includes(TICKETMASTER_KEY));
    }
    assert.equal(service.upstream.cached(), 0);
  });

  test("a Worker without Ticketmaster's key answers 503 and asks nobody", async () => {
    const service = await harness({ ticketmasterKey: null });
    const session = await service.signIn();
    const response = await service.request("GET", EVENTS, { session });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "unavailable" });
    assert.deepEqual(service.upstream.calls, []);
  });
});

describe("each account's limits on Ticketmaster", () => {
  test("past maxTicketmasterRequestsPerMinute an account answers 429 and others keep going", async () => {
    const service = await harness({ limits: { maxTicketmasterRequestsPerMinute: 2 } });
    const ana = await service.signIn();
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    const ask = (session: string) => service.request("GET", EVENTS, { session });
    for (let i = 0; i < 2; i++) assert.equal((await ask(ana)).status, 200);
    const refused = await ask(ana);
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), {
      error: "limit",
      limit: "maxTicketmasterRequestsPerMinute",
    });
    assert.equal((await ask(bo)).status, 200);
  });

  for (const [kind, limit, path, other] of [
    ["attraction searches", "maxTicketmasterAttractionSearchesPerDay", ATTRACTIONS, EVENTS],
    ["event lookups", "maxTicketmasterEventLookupsPerDay", EVENTS, ATTRACTIONS],
  ] as const) {
    test(`an account makes ${limit} ${kind} in a UTC day, cached answers included`, async () => {
      const service = await harness({ limits: { [limit]: 2 } });
      service.now = Date.UTC(2026, 9, 14, 12);
      const ana = await service.signIn();
      const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
      const ask = (session: string, at = path) => service.request("GET", at, { session });
      for (let i = 0; i < 2; i++) assert.equal((await ask(ana)).status, 200);
      assert.equal(service.upstream.calls.length, 1, "the second answer came from the cache");
      const refused = await ask(ana);
      assert.equal(refused.status, 429);
      assert.deepEqual(await refused.json(), { error: "limit", limit });
      assert.equal(Number(refused.headers.get("retry-after")), 12 * 60 * 60);
      assert.equal(service.upstream.calls.length, 1);
      assert.equal((await ask(ana, other)).status, 200, "the other kind counts apart");
      assert.equal((await ask(bo)).status, 200, "another account counts apart");

      service.now = Date.UTC(2026, 9, 15, 0, 0, 1);
      assert.equal((await ask(ana)).status, 200);
    });
  }

  test("an account may check 200 artists a day: an attraction search and an event lookup each", () => {
    assert.equal(SYNC_LIMITS.maxTicketmasterAttractionSearchesPerDay, 200);
    assert.equal(SYNC_LIMITS.maxTicketmasterEventLookupsPerDay, 200);
    // The phone starts a show check's calls at least 250 ms apart: 240 a minute at most.
    assert.ok(SYNC_LIMITS.maxTicketmasterRequestsPerMinute >= 240);
  });
});

describe("what the Ticketmaster routes log", () => {
  test("no line holds the artist, the account or the key", async () => {
    const service = await harness();
    const session = await service.signIn();
    service.upstream.answer = overQuota;
    await service.request("GET", ATTRACTIONS, { session });
    await service.request("GET", EVENTS, { session });
    const account = (await service.db.execute("SELECT id FROM accounts")).rows[0]?.id;
    assert.ok(service.logs.length > 0);
    for (const line of service.logs) {
      for (const secret of [
        "Coldplay",
        "K8vZ917_XCf",
        "ana@example.com",
        session,
        String(account),
        TICKETMASTER_KEY,
      ]) {
        assert.ok(!line.includes(secret), line);
      }
    }
  });
});
