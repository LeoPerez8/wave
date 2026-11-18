import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type Harness, harness, sessionCount } from "./testing.ts";

/** Signs in as Ana and answers the service's response. */
const signInResponse = async (service: Harness, claims?: Record<string, unknown>) =>
  service.request("POST", "/v1/session", {
    json: { idToken: await service.google.idToken(claims) },
  });

/** Signs in [n] times as Ana, giving the session tokens. */
const signInTimes = async (service: Harness, n: number): Promise<string[]> => {
  const sessions: string[] = [];
  for (let i = 0; i < n; i++) sessions.push(await service.signIn());
  return sessions;
};

const pulls = async (service: Harness, session: string): Promise<number> =>
  (await service.request("GET", "/v1/pull", { session })).status;

describe("valid sessions per account", () => {
  test("the tenth session signs in; the eleventh is refused and every earlier one still works", async () => {
    const service = await harness({ limits: { maxSignInsPerMinute: 100 } });
    const sessions = await signInTimes(service, 10);

    const refused = await signInResponse(service);
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: "limit", limit: "maxSessionsPerAccount" });
    assert.equal(await sessionCount(service), 10);
    for (const session of sessions) assert.equal(await pulls(service, session), 200);
  });

  test("a sign-in deletes the account's sessions unused for 90 days before counting", async () => {
    const service = await harness({ limits: { maxSignInsPerMinute: 100 } });
    const stale = await signInTimes(service, 4);
    service.now += 60 * DAY;
    const recent = await signInTimes(service, 6);
    service.now += 30 * DAY + 1;

    assert.equal((await signInResponse(service)).status, 200);
    assert.equal(await sessionCount(service), 7);
    for (const session of recent) assert.equal(await pulls(service, session), 200);
    for (const session of stale) assert.equal(await pulls(service, session), 401);
  });

  test("a session still in use within 90 days counts toward the limit", async () => {
    const service = await harness({ limits: { maxSignInsPerMinute: 100 } });
    const sessions = await signInTimes(service, 10);
    service.now += 89 * DAY;
    assert.equal(await pulls(service, sessions[0]!), 200);
    service.now += 2 * DAY;

    // Nine went unused past 90 days; the one renewed two days ago still counts.
    assert.equal((await signInResponse(service)).status, 200);
    assert.equal(await sessionCount(service), 2);
    assert.equal(await pulls(service, sessions[0]!), 200);
  });

  test("sign-ins at once can't take more places than are left", async () => {
    const service = await harness({ limits: { maxSignInsPerMinute: 100 } });
    const sessions = await signInTimes(service, 8);
    const idTokens = await Promise.all(Array.from({ length: 6 }, () => service.google.idToken()));
    const answers = await Promise.all(
      idTokens.map((idToken) => service.request("POST", "/v1/session", { json: { idToken } })),
    );
    const statuses = answers.map((answer) => answer.status).sort();
    assert.deepEqual(statuses, [200, 200, 403, 403, 403, 403]);
    assert.equal(await sessionCount(service), 10);
    for (const session of sessions) assert.equal(await pulls(service, session), 200);
  });

  test("an account above the limit before it came keeps every session and signs in again below it", async () => {
    const before = await harness({
      limits: { maxSignInsPerMinute: 100, maxSessionsPerAccount: 100 },
    });
    const sessions = await signInTimes(before, 12);
    const service = await harness({ limits: { maxSignInsPerMinute: 100 } }, before.db);
    service.now = before.now;

    assert.equal((await signInResponse(service)).status, 403);
    assert.equal(await sessionCount(service), 12);
    for (const session of sessions) assert.equal(await pulls(service, session), 200);

    for (const session of sessions.slice(0, 2)) {
      assert.equal((await service.request("DELETE", "/v1/session", { session })).status, 204);
    }
    assert.equal((await signInResponse(service)).status, 403);
    await service.request("DELETE", "/v1/session", { session: sessions[2]! });
    assert.equal((await signInResponse(service)).status, 200);
    assert.equal((await signInResponse(service)).status, 403);
    for (const session of sessions.slice(3)) assert.equal(await pulls(service, session), 200);
  });

  test("Sign Out on All Phones frees only its own account's places", async () => {
    const service = await harness({ limits: { maxSignInsPerMinute: 100 } });
    const ana = await signInTimes(service, 10);
    const bo = { sub: "google-sub-2", email: "bo@example.com" };
    const boSessions: string[] = [];
    for (let i = 0; i < 10; i++) boSessions.push(await service.signIn(bo));

    assert.equal(
      (await service.request("DELETE", "/v1/sessions", { session: ana[0]! })).status,
      204,
    );
    assert.equal((await signInResponse(service)).status, 200);
    assert.equal((await signInResponse(service, bo)).status, 403);
    for (const session of boSessions) assert.equal(await pulls(service, session), 200);
  });
});

const DAY = 24 * 60 * 60 * 1000;
