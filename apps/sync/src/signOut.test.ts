import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { harness } from "./testing.ts";

describe("DELETE /v1/sessions", () => {
  test("ends every session of the caller's account and no other account's", async () => {
    const service = await harness();
    const phone = await service.signIn();
    const otherPhone = await service.signIn();
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });

    const ended = await service.request("DELETE", "/v1/sessions", { session: phone });
    assert.equal(ended.status, 204);

    for (const session of [phone, otherPhone]) {
      assert.equal((await service.request("GET", "/v1/pull", { session })).status, 401);
    }
    assert.equal((await service.request("GET", "/v1/pull", { session: bo })).status, 200);
  });

  test("needs a session", async () => {
    const service = await harness();
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    for (const session of [undefined, "not-a-session"]) {
      const response = await service.request(
        "DELETE",
        "/v1/sessions",
        session === undefined ? {} : { session },
      );
      assert.equal(response.status, 401);
    }
    assert.equal((await service.request("GET", "/v1/pull", { session: bo })).status, 200);
  });

  test("a sign-in afterwards works", async () => {
    const service = await harness();
    const phone = await service.signIn();
    await service.request("DELETE", "/v1/sessions", { session: phone });
    const fresh = await service.signIn();
    assert.equal((await service.request("GET", "/v1/pull", { session: fresh })).status, 200);
  });
});
