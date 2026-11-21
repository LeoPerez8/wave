import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type Harness,
  type TokenClaims,
  freshDatabase,
  harness,
  requestAccountDeletion,
} from "./testing.ts";
import { migrate } from "./migrations.ts";

/** Signs in with [claims] and gives what the service answers. */
const signedIn = async (
  service: Harness,
  claims?: TokenClaims,
): Promise<{ readonly sessionToken: string; readonly name: string | null }> => {
  const response = await service.request("POST", "/v1/session", {
    json: { idToken: await service.google.idToken(claims) },
  });
  assert.equal(response.status, 200);
  return (await response.json()) as { sessionToken: string; name: string | null };
};

/** The name the service keeps for the account [claims] sign in to; the token itself names none. */
const keptName = async (service: Harness, claims?: TokenClaims): Promise<string | null> =>
  (await signedIn(service, { ...claims, name: undefined })).name;

const BO = { sub: "google-sub-2", email: "bo@example.com" };

describe("a sign-in keeps the Google account's name", () => {
  test("the first sign-in stores the token's name", async () => {
    const service = await harness();
    assert.equal((await signedIn(service, { name: "Ana Souza" })).name, "Ana Souza");
    assert.equal(await keptName(service), "Ana Souza");
  });

  test("a later sign-in with another name replaces it", async () => {
    const service = await harness();
    await signedIn(service, { name: "Ana Souza" });
    assert.equal((await signedIn(service, { name: "Ana S. Lima" })).name, "Ana S. Lima");
    assert.equal(await keptName(service), "Ana S. Lima");
  });

  test("an account whose token has no name keeps none", async () => {
    const service = await harness();
    assert.equal((await signedIn(service)).name, null);
    assert.equal(await keptName(service), null);
  });

  test("a name that isn't text, or is only space, counts as none", async () => {
    const service = await harness();
    assert.equal((await signedIn(service, { name: 42 })).name, null);
    assert.equal((await signedIn(service, { name: "   " })).name, null);
  });

  test("a name past 100 characters is cut to 100", async () => {
    const service = await harness();
    assert.equal((await signedIn(service, { name: "n".repeat(300) })).name, "n".repeat(100));
  });

  test("each account has its own name", async () => {
    const service = await harness();
    await signedIn(service, { name: "Ana Souza" });
    await signedIn(service, { ...BO, name: "Bo Lima" });
    assert.equal(await keptName(service), "Ana Souza");
    assert.equal(await keptName(service, BO), "Bo Lima");
  });

  test("an account made before the names were kept signs in and gets one", async () => {
    const db = await freshDatabase({ until: "0015_playlist_entry_restores" });
    await db.execute({
      sql: "INSERT INTO accounts (id, google_sub, email, created_at) VALUES (?, ?, ?, ?)",
      args: ["account-1", "google-sub-1", "ana@example.com", Date.UTC(2026, 0, 1)],
    });
    assert.equal((await migrate(db))[0], "0016_account_name");

    // One place in all: the sign-in works only as the account that was already there.
    const service = await harness({ limits: { maxAccounts: 1 } }, db);
    assert.equal(await keptName(service), null);
    assert.equal((await signedIn(service, { name: "Ana Souza" })).name, "Ana Souza");
  });
});

describe("PUT /v1/account/name", () => {
  const put = (service: Harness, session: string | undefined, json: unknown): Promise<Response> =>
    service.request(
      "PUT",
      "/v1/account/name",
      session === undefined ? { json } : { session, json },
    );

  test("stores the name for the session's account, and no other", async () => {
    const service = await harness();
    const { sessionToken } = await signedIn(service);
    await signedIn(service, BO);
    const response = await put(service, sessionToken, { name: "Ana Souza" });
    assert.equal(response.status, 204);
    assert.equal(await keptName(service), "Ana Souza");
    assert.equal(await keptName(service, BO), null);
  });

  test("the name is cleaned and cut as a sign-in's is", async () => {
    const service = await harness();
    const { sessionToken } = await signedIn(service);
    assert.equal(
      (await put(service, sessionToken, { name: `  Ana\n${"a".repeat(200)}` })).status,
      204,
    );
    assert.equal(await keptName(service), `Ana ${"a".repeat(96)}`);
  });

  test("without a session it answers 401 and stores nothing", async () => {
    const service = await harness();
    await signedIn(service);
    assert.equal((await put(service, undefined, { name: "Ana Souza" })).status, 401);
    assert.equal((await put(service, "x".repeat(43), { name: "Ana Souza" })).status, 401);
    assert.equal(await keptName(service), null);
  });

  test("a body without a name answers 400 and keeps the name there was", async () => {
    const service = await harness();
    const { sessionToken } = await signedIn(service, { name: "Ana Souza" });
    for (const body of [{}, { name: "" }, { name: "  " }, { name: 7 }, "Ana", null]) {
      const response = await put(service, sessionToken, body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "bad_request" });
    }
    assert.equal(await keptName(service), "Ana Souza");
  });

  test("a sign-in without a name keeps the name the route stored; one with a name replaces it", async () => {
    const service = await harness();
    const { sessionToken } = await signedIn(service);
    await put(service, sessionToken, { name: "Ana" });
    assert.equal((await signedIn(service)).name, "Ana");
    assert.equal((await signedIn(service, { name: "Ana Souza" })).name, "Ana Souza");
  });
});

describe("deleting the account deletes its name", () => {
  test("the same Google account signing in again has no name", async () => {
    const service = await harness();
    const { sessionToken } = await signedIn(service, { name: "Ana Souza" });
    assert.equal((await requestAccountDeletion(service, sessionToken)).status, 204);
    assert.equal(await keptName(service), null);
  });
});
