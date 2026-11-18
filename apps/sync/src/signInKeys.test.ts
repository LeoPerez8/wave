import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { favorite, harness, pull, push, sessionCount } from "./testing.ts";

type Service = Awaited<ReturnType<typeof harness>>;

/** `POST /v1/session` from [ip] with [idToken]. */
const attempt = (service: Service, ip: string, idToken: string): Promise<Response> =>
  service.request("POST", "/v1/session", {
    json: { idToken },
    headers: { "cf-connecting-ip": ip },
  });

describe("sign-in keys per minute", () => {
  test("past maxSignInKeysPerMinute, a sign-in that needs a new key answers 429 until the next minute", async () => {
    const service = await harness({ limits: { maxSignInKeysPerMinute: 3 } });
    service.now = Date.UTC(2026, 9, 14, 12, 0, 40);
    const forged = await service.google.forgedIdToken();
    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) {
      assert.equal((await attempt(service, ip, forged)).status, 401, ip);
    }

    const refused = await attempt(service, "198.51.100.4", await service.google.idToken());
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: "limit", limit: "maxSignInKeysPerMinute" });
    assert.equal(refused.headers.get("retry-after"), "20");

    service.now = Date.UTC(2026, 9, 14, 12, 1);
    assert.equal(
      (await attempt(service, "198.51.100.4", await service.google.idToken())).status,
      200,
    );
  });

  test("at maxSignInKeysPerMinute, keys already counted count on, with no reset, to maxSignInsPerMinute", async () => {
    const service = await harness({
      limits: { maxSignInKeysPerMinute: 2, maxSignInsPerMinute: 3 },
    });
    const forged = await service.google.forgedIdToken();
    assert.equal((await attempt(service, "198.51.100.1", forged)).status, 401);
    assert.equal((await attempt(service, "198.51.100.2", forged)).status, 401);
    assert.equal((await attempt(service, "198.51.100.3", forged)).status, 429);

    assert.equal((await attempt(service, "198.51.100.1", forged)).status, 401);
    assert.equal((await attempt(service, "198.51.100.1", forged)).status, 401);
    const past = await attempt(service, "198.51.100.1", forged);
    assert.equal(past.status, 429);
    assert.deepEqual(await past.json(), { error: "limit", limit: "maxSignInsPerMinute" });
  });

  test("at maxSignInKeysPerMinute, sessions already made keep pushing and pulling", async () => {
    const service = await harness({ limits: { maxSignInKeysPerMinute: 3 } });
    const session = await service.signIn();
    const forged = await service.google.forgedIdToken();
    assert.equal((await attempt(service, "198.51.100.1", forged)).status, 401);
    assert.equal((await attempt(service, "198.51.100.2", forged)).status, 401);
    assert.equal((await attempt(service, "198.51.100.3", forged)).status, 429);

    await push(service, session, { favorites: [favorite("k1", 1)] });
    assert.deepEqual(
      (await pull(service, session)).favorites.map((row) => row.id),
      ["k1"],
    );
  });

  test("a sign-in counts its address and its Google account in one budget, and never past it", async () => {
    const service = await harness({ limits: { maxSignInKeysPerMinute: 2 } });
    const forged = await service.google.forgedIdToken();
    assert.equal((await attempt(service, "198.51.100.1", forged)).status, 401);

    // The address takes the last key; the Google account finds none left.
    const refused = await attempt(service, "198.51.100.2", await service.google.idToken());
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: "limit", limit: "maxSignInKeysPerMinute" });
    assert.equal(await sessionCount(service), 0);
    const kept = await service.db.execute("SELECT count(*) AS n FROM sign_in_windows");
    assert.equal(Number(kept.rows[0]?.n), 2);
  });

  test("sign-ins at once for the last key: one takes it, the rest answer 429", async () => {
    const service = await harness({ limits: { maxSignInKeysPerMinute: 2 } });
    const forged = await service.google.forgedIdToken();
    assert.equal((await attempt(service, "198.51.100.1", forged)).status, 401);

    const answers = await Promise.all(
      ["198.51.100.2", "198.51.100.3", "198.51.100.4", "198.51.100.5"].map((ip) =>
        attempt(service, ip, forged),
      ),
    );
    assert.deepEqual(answers.map((answer) => answer.status).sort(), [401, 429, 429, 429]);
    const kept = await service.db.execute("SELECT count(*) AS n FROM sign_in_windows");
    assert.equal(Number(kept.rows[0]?.n), 2);
  });
});
