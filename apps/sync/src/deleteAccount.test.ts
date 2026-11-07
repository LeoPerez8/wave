import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type Harness, type TokenClaims, favorite, harness, push, pull } from "./testing.ts";

/** Ana signed in, with a favorite and a Soulseek account the service keeps. */
const anaWithRows = async (service: Harness): Promise<string> => {
  const session = await service.signIn();
  await push(service, session, { favorites: [favorite("song-1", 1)] });
  const soulseek = { username: "quietfern42", password: "fixture-soulseek-password" };
  await service.request("PUT", "/v1/soulseek", { session, json: soulseek });
  return session;
};

/** Whether Ana's rows are all still there, through her session. */
const keptEverything = async (service: Harness, session: string): Promise<void> => {
  assert.deepEqual(
    (await pull(service, session)).favorites.map((row) => row.id),
    ["song-1"],
  );
  const soulseek = await service.request("GET", "/v1/soulseek", { session });
  assert.equal(
    ((await soulseek.json()) as { account: { username: string } | null }).account?.username,
    "quietfern42",
  );
};

describe("DELETE /v1/account needs a fresh Google sign-in", () => {
  test("an ID token for the session's Google account, just issued, deletes the account", async () => {
    const service = await harness();
    const session = await anaWithRows(service);
    const response = await service.request("DELETE", "/v1/account", {
      session,
      json: { idToken: await service.google.idToken() },
    });
    assert.equal(response.status, 204);
    assert.equal((await service.request("GET", "/v1/pull", { session })).status, 401);
  });

  test("an ID token issued just under 5 minutes ago is still fresh", async () => {
    const service = await harness();
    const session = await anaWithRows(service);
    const iat = Math.floor(service.now / 1000) - 4 * 60 - 50;
    const response = await service.request("DELETE", "/v1/account", {
      session,
      json: { idToken: await service.google.idToken({ iat }) },
    });
    assert.equal(response.status, 204);
  });

  test("a missing ID token answers 401 and deletes nothing", async () => {
    const service = await harness();
    const session = await anaWithRows(service);
    for (const init of [{}, { json: {} }, { json: { idToken: 7 } }, { body: "not json" }]) {
      const response = await service.request("DELETE", "/v1/account", { session, ...init });
      assert.equal(response.status, 401, JSON.stringify(init));
      assert.deepEqual(await response.json(), { error: "id_token_required" });
    }
    await keptEverything(service, session);
  });

  test("an ID token from another Google account, too old, or badly signed answers 401 and deletes nothing", async () => {
    const service = await harness();
    const session = await anaWithRows(service);
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    const seconds = Math.floor(service.now / 1000);
    const refused: readonly (readonly [string, () => Promise<string>])[] = [
      [
        "another account",
        () => service.google.idToken({ sub: "google-sub-2", email: "bo@example.com" }),
      ],
      ["issued 6 minutes ago", () => service.google.idToken({ iat: seconds - 6 * 60 })],
      ["no issue time", () => service.google.idToken({ iat: undefined } satisfies TokenClaims)],
      ["bad signature", () => service.google.forgedIdToken()],
      ["expired", () => service.google.idToken({ exp: seconds - 3600 })],
      [
        "another app",
        () => service.google.idToken({ aud: "someone-else.apps.googleusercontent.com" }),
      ],
    ];
    for (const [why, idToken] of refused) {
      const response = await service.request("DELETE", "/v1/account", {
        session,
        json: { idToken: await idToken() },
      });
      assert.equal(response.status, 401, why);
      assert.deepEqual(await response.json(), { error: "invalid_id_token" }, why);
    }
    await keptEverything(service, session);
    assert.equal((await service.request("GET", "/v1/pull", { session: bo })).status, 200);
  });

  test("a valid ID token without a session deletes nothing", async () => {
    const service = await harness();
    const session = await anaWithRows(service);
    const response = await service.request("DELETE", "/v1/account", {
      json: { idToken: await service.google.idToken() },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
    await keptEverything(service, session);
  });
});
