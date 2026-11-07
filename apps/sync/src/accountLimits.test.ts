import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SYNC_LIMITS } from "./limits.ts";
import { type Harness, harness, sessionCount } from "./testing.ts";

const HOUR = 3_600_000;

const accountCount = async (service: Harness): Promise<number> =>
  Number((await service.db.execute("SELECT count(*) AS n FROM accounts")).rows[0]?.n);

/** Signs in as Google account [n], answering the service's response. */
const signInAs = async (service: Harness, n: number): Promise<Response> =>
  service.request("POST", "/v1/session", {
    json: {
      idToken: await service.google.idToken({ sub: `sub-${n}`, email: `p${n}@example.com` }),
    },
  });

describe("account limits", () => {
  test("start at 100 accounts and 10 new accounts a day", () => {
    assert.equal(SYNC_LIMITS.maxAccounts, 100);
    assert.equal(SYNC_LIMITS.maxNewAccountsPerDay, 10);
  });

  test("past maxAccounts, a new Google account is refused and nothing is made", async () => {
    const service = await harness({ limits: { maxAccounts: 2 } });
    assert.equal((await signInAs(service, 1)).status, 200);
    assert.equal((await signInAs(service, 2)).status, 200);
    const refused = await signInAs(service, 3);
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: "limit", limit: "maxAccounts" });
    assert.equal(await accountCount(service), 2);
    assert.equal(await sessionCount(service), 2);
  });

  test("at maxAccounts, an existing account still signs in", async () => {
    const service = await harness({ limits: { maxAccounts: 1 } });
    assert.equal((await signInAs(service, 1)).status, 200);
    assert.equal((await signInAs(service, 2)).status, 403);
    const again = await signInAs(service, 1);
    assert.equal(again.status, 200);
    assert.equal(await sessionCount(service), 2);
  });

  test("a deleted account frees its place", async () => {
    const service = await harness({ limits: { maxAccounts: 1 } });
    const response = await signInAs(service, 1);
    const { sessionToken } = (await response.json()) as { sessionToken: string };
    await service.request("DELETE", "/v1/account", { session: sessionToken });
    assert.equal((await signInAs(service, 2)).status, 200);
  });

  test("past maxNewAccountsPerDay, a new Google account is refused until a day after the oldest", async () => {
    const service = await harness({ limits: { maxNewAccountsPerDay: 2 } });
    const start = service.now;
    assert.equal((await signInAs(service, 1)).status, 200);
    service.now = start + 5 * HOUR;
    assert.equal((await signInAs(service, 2)).status, 200);
    service.now = start + 10 * HOUR;
    const refused = await signInAs(service, 3);
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: "limit", limit: "maxNewAccountsPerDay" });
    assert.equal(refused.headers.get("retry-after"), String(14 * 3600));
    assert.equal(await accountCount(service), 2);

    // Existing accounts aren't held back by it.
    assert.equal((await signInAs(service, 1)).status, 200);

    service.now = start + 24 * HOUR;
    assert.equal((await signInAs(service, 3)).status, 200);
    assert.equal((await signInAs(service, 4)).status, 429);
  });

  test("two racing sign-ins can't both take the last place", async () => {
    for (const limits of [{ maxAccounts: 1 }, { maxNewAccountsPerDay: 1 }]) {
      const service = await harness({ limits });
      const answers = await Promise.all([signInAs(service, 1), signInAs(service, 2)]);
      const statuses = answers.map((answer) => answer.status).toSorted();
      assert.equal(statuses[0], 200, JSON.stringify(limits));
      assert.notEqual(statuses[1], 200, JSON.stringify(limits));
      assert.equal(await accountCount(service), 1, JSON.stringify(limits));
      assert.equal(await sessionCount(service), 1, JSON.stringify(limits));
    }
  });
});
