import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type Harness,
  favorite,
  harness,
  pull,
  push,
  requestAccountDeletion,
  sessionCount,
} from "./testing.ts";

const HOUR = 3_600_000;

const accountCount = async (service: Harness): Promise<number> =>
  Number((await service.db.execute("SELECT count(*) AS n FROM accounts")).rows[0]?.n);

/** Google account [n]'s claims. */
const person = (n: number) => ({ sub: `sub-${n}`, email: `p${n}@example.com` });

/** Signs in as Google account [n], answering the service's response. */
const signInAs = async (service: Harness, n: number): Promise<Response> =>
  service.request("POST", "/v1/session", {
    json: {
      idToken: await service.google.idToken(person(n)),
    },
  });

describe("account limits", () => {
  test("admit ten Google accounts at once and refuse an eleventh on a later day", async () => {
    const service = await harness();
    for (let n = 1; n <= 10; n++) assert.equal((await signInAs(service, n)).status, 200);
    service.now += 24 * HOUR;
    const refused = await signInAs(service, 11);
    assert.equal(refused.status, 403);
    assert.deepEqual(await refused.json(), { error: "limit", limit: "maxAccounts" });
    assert.equal(await accountCount(service), 10);
  });

  test("a full service keeps its ten accounts working and hands a deleted one's place to one newcomer", async () => {
    const service = await harness();
    const sessions: string[] = [];
    for (let n = 1; n <= 10; n++) {
      const response = await signInAs(service, n);
      assert.equal(response.status, 200);
      const { sessionToken } = (await response.json()) as { sessionToken: string };
      await push(service, sessionToken, { favorites: [favorite(`song-of-${n}`, n)] });
      sessions.push(sessionToken);
    }

    // A second phone for an existing account takes no new place.
    const secondPhone = await signInAs(service, 1);
    assert.equal(secondPhone.status, 200);
    assert.equal(await accountCount(service), 10);
    assert.equal((await signInAs(service, 11)).status, 403);

    // Deleting an account frees its place with no one admitting the next.
    const deleted = await requestAccountDeletion(service, sessions[2]!, person(3));
    assert.equal(deleted.status, 204);
    assert.equal((await service.request("GET", "/v1/pull", { session: sessions[2] })).status, 401);
    assert.equal(
      Number(
        (
          await service.db.execute({
            sql: "SELECT count(*) AS n FROM accounts WHERE google_sub = ?",
            args: ["sub-3"],
          })
        ).rows[0]?.n,
      ),
      0,
    );

    // Two newcomers race for it: one gets it, the other is refused.
    const raced = await Promise.all([signInAs(service, 11), signInAs(service, 12)]);
    assert.deepEqual(raced.map((answer) => answer.status).toSorted(), [200, 403]);
    assert.equal(await accountCount(service), 10);

    // The newcomer starts empty, and the others keep their own rows.
    const winner = raced.find((answer) => answer.status === 200)!;
    const { sessionToken } = (await winner.json()) as { sessionToken: string };
    assert.deepEqual((await pull(service, sessionToken)).favorites, []);
    assert.deepEqual(
      (await pull(service, sessions[0]!)).favorites.map((row) => row.id),
      ["song-of-1"],
    );
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
    assert.equal(
      (
        await requestAccountDeletion(service, sessionToken, {
          sub: "sub-1",
          email: "p1@example.com",
        })
      ).status,
      204,
    );
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
