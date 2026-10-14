import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { favorite, harness, pull, push, sessionCount } from "./testing.ts";

describe("POST /v1/session", () => {
  test("a valid Google ID token signs in and gives a session token", async () => {
    const service = await harness();
    const response = await service.request("POST", "/v1/session", {
      json: { idToken: await service.google.idToken() },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { sessionToken: unknown; email: unknown };
    assert.equal(typeof body.sessionToken, "string");
    assert.ok((body.sessionToken as string).length >= 32);
    assert.equal(body.email, "ana@example.com");
  });

  test("a forged ID token is refused, and no session is made", async () => {
    const service = await harness();
    const response = await service.request("POST", "/v1/session", {
      json: { idToken: await service.google.forgedIdToken() },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "invalid_id_token" });
    assert.equal(await sessionCount(service), 0);
  });

  test("an ID token for another app, from another issuer, expired or unverified is refused", async () => {
    const service = await harness();
    const refused = [
      { aud: "someone-else.apps.googleusercontent.com" },
      { iss: "https://evil.example.com" },
      { exp: Math.floor(service.now / 1000) - 3600 },
      { email_verified: false },
      { sub: undefined },
    ];
    for (const claims of refused) {
      const response = await service.request("POST", "/v1/session", {
        json: { idToken: await service.google.idToken(claims) },
      });
      assert.equal(response.status, 401, JSON.stringify(claims));
    }
  });

  test("something that isn't an ID token is refused", async () => {
    const service = await harness();
    for (const idToken of ["", "a.b.c", "not a token", "x.y"]) {
      const response = await service.request("POST", "/v1/session", { json: { idToken } });
      assert.equal(response.status, 401, idToken);
    }
    const noToken = await service.request("POST", "/v1/session", { json: {} });
    assert.equal(noToken.status, 400);
  });

  test("signing in again with the same Google account reaches the same account", async () => {
    const service = await harness();
    const first = await service.signIn();
    await push(service, first, { favorites: [favorite("k1", 1)] });
    const second = await service.signIn();
    assert.notEqual(first, second);
    const pulled = await pull(service, second);
    assert.deepEqual(
      pulled.favorites.map((row) => row.id),
      ["k1"],
    );
  });

  test("with no allowlist, any Google account signs in", async () => {
    const service = await harness();
    const response = await service.request("POST", "/v1/session", {
      json: { idToken: await service.google.idToken({ email: "anyone@example.com" }) },
    });
    assert.equal(response.status, 200);
  });

  test("with an allowlist, only its emails sign in", async () => {
    const service = await harness({ allowedEmails: "ana@example.com, Bo@Example.com" });
    const allowed = await service.request("POST", "/v1/session", {
      json: { idToken: await service.google.idToken({ email: "bo@example.com", sub: "bo" }) },
    });
    assert.equal(allowed.status, 200);
    const refused = await service.request("POST", "/v1/session", {
      json: { idToken: await service.google.idToken({ email: "eve@example.com", sub: "eve" }) },
    });
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: "not_allowed" });
  });

  test("Google's keys are fetched once and kept", async () => {
    const service = await harness();
    await service.signIn();
    await service.signIn();
    assert.equal(service.google.certFetches(), 1);
  });
});

describe("DELETE /v1/session", () => {
  test("ends the session: it no longer pulls or pushes", async () => {
    const service = await harness();
    const session = await service.signIn();
    const ended = await service.request("DELETE", "/v1/session", { session });
    assert.equal(ended.status, 204);
    const pulled = await service.request("GET", "/v1/pull", { session });
    assert.equal(pulled.status, 401);
    const pushed = await service.request("POST", "/v1/push", { session, json: {} });
    assert.equal(pushed.status, 401);
  });

  test("leaves the account's other sessions signed in", async () => {
    const service = await harness();
    const phoneA = await service.signIn();
    const phoneB = await service.signIn();
    await service.request("DELETE", "/v1/session", { session: phoneA });
    const pulled = await service.request("GET", "/v1/pull", { session: phoneB });
    assert.equal(pulled.status, 200);
  });

  test("without a session token answers 401", async () => {
    const service = await harness();
    for (const session of [undefined, "", "made-up"]) {
      const response = await service.request("DELETE", "/v1/session", {
        ...(session === undefined ? {} : { session }),
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthorized" });
    }
  });
});

describe("session tokens", () => {
  test("are stored only as a hash", async () => {
    const service = await harness();
    const session = await service.signIn();
    const stored = await service.db.execute("SELECT * FROM sessions");
    assert.equal(stored.rows.length, 1);
    assert.ok(!JSON.stringify(stored.rows).includes(session));
  });

  test("only POST /v1/session answers one", async () => {
    const service = await harness();
    const session = await service.signIn();
    const answers = [
      await service.request("POST", "/v1/push", { session, json: { favorites: [favorite("k", 1)] } }),
      await service.request("GET", "/v1/pull", { session }),
      await service.request("DELETE", "/v1/session", { session }),
    ];
    for (const answer of answers) {
      assert.ok(!(await answer.text()).includes(session));
      assert.ok(![...answer.headers.values()].some((value) => value.includes(session)));
    }
  });
});
