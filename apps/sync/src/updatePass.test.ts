import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { importUpdatePassPublicKeys, readUpdatePass, updatePassIsValid } from "@wave/core";
import { harness } from "./testing.ts";

describe("GET /v1/update-pass", () => {
  it("issues the same verifiable, private response to two signed-in accounts", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const service = await harness({ updatePassSigningKey: privateKey });
    const ask = (session?: string) =>
      service.request("GET", "/v1/update-pass", session === undefined ? {} : { session });
    assert.equal((await ask()).status, 401);
    const firstSession = await service.signIn();
    const secondSession = await service.signIn({ sub: "another-user", email: "bea@example.com" });
    const first = await ask(firstSession);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "no-store");
    const pass = readUpdatePass(await first.json());
    assert.ok(pass);
    assert.deepEqual(await (await ask(secondSession)).json(), pass);
    assert.equal(pass.expiresAt, Date.UTC(2026, 10, 14));
    assert.equal(
      await updatePassIsValid(await importUpdatePassPublicKeys(publicKey), pass.pass, service.now),
      true,
    );

    await service.request("DELETE", "/v1/session", { session: firstSession });
    assert.equal((await ask(firstSession)).status, 401);
  });

  it("returns no pass without a usable signing key and keeps key material out of the log", async () => {
    for (const options of [{}, { updatePassSigningKey: "invalid-key-fixture" }]) {
      const service = await harness(options);
      const session = await service.signIn();
      const response = await service.request("GET", "/v1/update-pass", { session });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { pass: null });
      assert.deepEqual(
        service.logs,
        "updatePassSigningKey" in options ? ["sync service: update pass signing failed"] : [],
      );
      assert.equal((await service.request("POST", "/v1/update-pass", { session })).status, 404);
    }
  });
});
