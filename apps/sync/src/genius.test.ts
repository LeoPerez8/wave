import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GENIUS_TOKEN, harness } from "./testing.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A Genius search reply with one song hit. */
const searchReply = {
  meta: { status: 200 },
  response: {
    hits: [
      {
        type: "song",
        result: {
          id: 1063,
          title: "Bohemian Rhapsody",
          url: "https://genius.com/Queen-bohemian-rhapsody-lyrics",
          primary_artist: { name: "Queen" },
        },
      },
    ],
  },
};

describe("Genius through the sync service", () => {
  test("without a session, a search answers 401 and Genius is never asked", async () => {
    const service = await harness();
    for (const session of [undefined, "a".repeat(43)]) {
      const response = await service.request(
        "GET",
        "/v1/genius/search?q=Bohemian%20Queen",
        session === undefined ? {} : { session },
      );
      assert.equal(response.status, 401);
    }
    assert.deepEqual(service.upstream.calls, []);
  });

  test("with a session, a search answers Genius's reply, asked with the Worker's token", async () => {
    const service = await harness();
    const session = await service.signIn();
    service.upstream.answer = () => Response.json(searchReply);
    const response = await service.request(
      "GET",
      "/v1/genius/search?q=Bohemian%20Rhapsody%20Queen",
      { session },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), searchReply);
    assert.deepEqual(
      service.upstream.calls.map((call) => call.url),
      ["https://api.genius.com/search?q=Bohemian%20Rhapsody%20Queen"],
    );
    assert.equal(service.upstream.calls[0]?.headers.get("authorization"), `Bearer ${GENIUS_TOKEN}`);
  });

  test("the song and a page of its referents are asked as the Lyrics view asked Genius", async () => {
    const service = await harness();
    const session = await service.signIn();
    for (const path of ["/v1/genius/song?id=1063", "/v1/genius/referents?song=1063&page=2"]) {
      assert.equal((await service.request("GET", path, { session })).status, 200, path);
    }
    assert.deepEqual(
      service.upstream.calls.map((call) => call.url),
      [
        "https://api.genius.com/songs/1063?text_format=plain",
        "https://api.genius.com/referents?song_id=1063&text_format=plain&per_page=50&page=2",
      ],
    );
  });

  test("a request that isn't one of the fixed ones never reaches Genius", async () => {
    const service = await harness();
    const session = await service.signIn();
    const refused = [
      "/v1/genius/search",
      "/v1/genius/search?q=",
      "/v1/genius/search?q=%20",
      `/v1/genius/search?q=${"a".repeat(1001)}`,
      "/v1/genius/search?q=a&q=b",
      "/v1/genius/search?q=a&per_page=50",
      "/v1/genius/search?q=a&access_token=x",
      "/v1/genius/song",
      "/v1/genius/song?id=0",
      "/v1/genius/song?id=-1",
      "/v1/genius/song?id=012",
      "/v1/genius/song?id=1e3",
      "/v1/genius/song?id=1.5",
      "/v1/genius/song?id=99999999999999999",
      "/v1/genius/song?id=1%2F..%2F..%2Faccount",
      "/v1/genius/song?id=1&text_format=html",
      "/v1/genius/song?id=1&id=2",
      "/v1/genius/referents?song=1",
      "/v1/genius/referents?song=1&page=0",
      "/v1/genius/referents?song=1&page=21",
      "/v1/genius/referents?song=1&page=1&per_page=1000",
      "/v1/genius/referents?song_id=1&page=1",
    ];
    for (const path of refused) {
      const response = await service.request("GET", path, { session });
      assert.equal(response.status, 400, path);
      assert.deepEqual(await response.json(), { error: "bad_request" }, path);
    }
    for (const path of [
      "/v1/genius/songs/1",
      "/v1/genius/search/",
      "/v1/genius/../genius/account",
      "/v1/genius/annotations?id=1",
      "/v1/genius/artists?id=1",
      "/v1/genius",
    ]) {
      const response = await service.request("GET", path, { session });
      assert.equal(response.status, 404, path);
    }
    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await service.request(method, "/v1/genius/search?q=a", { session });
      assert.equal(response.status, 404, method);
    }
    assert.deepEqual(service.upstream.calls, []);
  });

  test("a search's text is only ever Genius's q: nothing in it adds a parameter", async () => {
    const service = await harness();
    const session = await service.signIn();
    const q = "AC/DC & Friends?page=2#x";
    const response = await service.request("GET", `/v1/genius/search?q=${encodeURIComponent(q)}`, {
      session,
    });
    assert.equal(response.status, 200);
    const asked = new URL(service.upstream.calls[0]?.url ?? "");
    assert.equal(asked.origin + asked.pathname, "https://api.genius.com/search");
    assert.deepEqual([...asked.searchParams], [["q", q]]);
  });
});

describe("Genius's answers, cached for every account", () => {
  test("a second account asking the same thing gets the answer with no request to Genius", async () => {
    const service = await harness();
    const ana = await service.signIn();
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    service.upstream.answer = () => Response.json(searchReply);
    for (const session of [ana, bo, ana]) {
      const response = await service.request("GET", "/v1/genius/search?q=Bohemian%20Queen", {
        session,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), searchReply);
    }
    assert.equal(service.upstream.calls.length, 1);

    await service.request("GET", "/v1/genius/search?q=Teardrop", { session: bo });
    assert.equal(service.upstream.calls.length, 2);
  });

  test("an answer is kept for a day, then asked again", async () => {
    const service = await harness();
    const session = await service.signIn();
    const ask = () => service.request("GET", "/v1/genius/song?id=1063", { session });
    await ask();
    service.now += DAY_MS - 60_000;
    await ask();
    assert.equal(service.upstream.calls.length, 1);
    service.now += 60_000;
    await ask();
    assert.equal(service.upstream.calls.length, 2);
  });

  test("an answer the phone gets says nothing may keep it on the way", async () => {
    const service = await harness();
    const session = await service.signIn();
    for (let i = 0; i < 2; i++) {
      const response = await service.request("GET", "/v1/genius/song?id=1063", { session });
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("set-cookie"), null);
    }
  });
});

describe("Genius's failures", () => {
  test("an error from Genius answers 502 with none of its body, and isn't kept", async () => {
    const service = await harness();
    const session = await service.signIn();
    for (const answer of [
      () =>
        Response.json(
          { meta: { status: 429, message: `Limit for token ${GENIUS_TOKEN}` } },
          { status: 429, headers: { "x-token": GENIUS_TOKEN } },
        ),
      () => new Response(`<html>Just a moment… ${GENIUS_TOKEN}</html>`, { status: 403 }),
      () =>
        new Response(null, {
          status: 302,
          headers: { location: `https://evil.example/?t=${GENIUS_TOKEN}` },
        }),
      () => new Response("<html>not json</html>", { status: 200 }),
      () => Response.json({ meta: { status: 200 }, echo: GENIUS_TOKEN }),
      () => Response.json({ echo: JSON.stringify(GENIUS_TOKEN) }),
      () => Promise.reject(new Error(`network down for ${GENIUS_TOKEN}`)),
    ]) {
      service.upstream.answer = answer;
      const response = await service.request("GET", "/v1/genius/song?id=1063", { session });
      assert.equal(response.status, 502);
      const text = await response.text();
      assert.deepEqual(JSON.parse(text), { error: "upstream_failed" });
      assert.ok(!text.includes(GENIUS_TOKEN));
      for (const [, value] of response.headers) assert.ok(!value.includes(GENIUS_TOKEN));
    }
    assert.equal(service.upstream.cached(), 0);
    for (const call of service.upstream.calls) {
      assert.ok(call.url.startsWith("https://api.genius.com/songs/1063?"), call.url);
    }
    service.upstream.answer = () => Response.json(searchReply);
    assert.equal(
      (await service.request("GET", "/v1/genius/song?id=1063", { session })).status,
      200,
    );
  });

  test("a Worker without Genius's token answers 503 and asks nobody", async () => {
    const service = await harness({ geniusToken: null });
    const session = await service.signIn();
    const response = await service.request("GET", "/v1/genius/search?q=a", { session });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "unavailable" });
    assert.deepEqual(service.upstream.calls, []);
  });
});

describe("each account's limits on Genius", () => {
  test("past maxGeniusRequestsPerMinute an account answers 429, cached answers too, and others keep going", async () => {
    const service = await harness({ limits: { maxGeniusRequestsPerMinute: 2 } });
    const ana = await service.signIn();
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    const ask = (session: string) => service.request("GET", "/v1/genius/song?id=1063", { session });
    for (let i = 0; i < 2; i++) assert.equal((await ask(ana)).status, 200);
    const refused = await ask(ana);
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: "limit", limit: "maxGeniusRequestsPerMinute" });
    assert.equal((await ask(bo)).status, 200);
    service.now += 60_000;
    assert.equal((await ask(ana)).status, 200);
    assert.equal(service.upstream.calls.length, 1);
  });

  test("past maxGeniusRequestsPerDay of requests Genius answers, an account gets only cached answers until the next day", async () => {
    const service = await harness({ limits: { maxGeniusRequestsPerDay: 2 } });
    service.now = Date.UTC(2026, 9, 14, 12);
    const ana = await service.signIn();
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    const ask = (session: string, id: number) =>
      service.request("GET", `/v1/genius/song?id=${id}`, { session });
    assert.equal((await ask(ana, 1)).status, 200);
    assert.equal((await ask(ana, 2)).status, 200);
    const refused = await ask(ana, 3);
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: "limit", limit: "maxGeniusRequestsPerDay" });
    assert.equal(Number(refused.headers.get("retry-after")), 12 * 60 * 60);
    assert.equal((await ask(ana, 1)).status, 200);
    assert.equal((await ask(bo, 3)).status, 200);
    assert.equal(service.upstream.calls.length, 3);

    service.now = Date.UTC(2026, 9, 15, 0, 0, 1);
    assert.equal((await ask(ana, 4)).status, 200);
  });
});

describe("what the Genius routes log", () => {
  test("no line holds the song, the account or the token", async () => {
    const service = await harness();
    const session = await service.signIn();
    service.upstream.answer = () => new Response("down", { status: 500 });
    await service.request("GET", "/v1/genius/search?q=Bohemian%20Rhapsody%20Queen", { session });
    await service.request("GET", "/v1/genius/referents?song=1063&page=1", { session });
    const account = (await service.db.execute("SELECT id FROM accounts")).rows[0]?.id;
    assert.ok(service.logs.length > 0);
    for (const line of service.logs) {
      for (const secret of ["Bohemian", "Rhapsody", "Queen", "1063", "ana@example.com", session]) {
        assert.ok(!line.includes(secret), line);
      }
      assert.ok(!line.includes(String(account)), line);
      assert.ok(!line.includes(GENIUS_TOKEN), line);
    }
  });
});
