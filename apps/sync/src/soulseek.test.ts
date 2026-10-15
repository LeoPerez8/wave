import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { harness } from "./testing.ts";

const ana = { username: "quietfern42", password: "fixture-soulseek-password-1" };

/** What `GET /v1/soulseek` answers for [session]. */
const soulseekOf = async (
  service: Awaited<ReturnType<typeof harness>>,
  session: string,
): Promise<unknown> => {
  const response = await service.request("GET", "/v1/soulseek", { session });
  assert.equal(response.status, 200);
  return response.json();
};

/** Runs [block] with every console line it prints collected. */
const printed = async (block: () => Promise<void>): Promise<string> => {
  const lines: unknown[][] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((name) => console[name]);
  for (const name of methods) console[name] = (...args: unknown[]) => void lines.push(args);
  try {
    await block();
  } finally {
    methods.forEach((name, i) => (console[name] = originals[i]!));
  }
  return lines.map((args) => args.map(String).join(" ")).join("\n");
};

describe("PUT and GET /v1/soulseek", () => {
  test("keeps the account's Soulseek account and answers it", async () => {
    const service = await harness();
    const session = await service.signIn();
    const put = await service.request("PUT", "/v1/soulseek", { session, json: ana });
    assert.equal(put.status, 204);

    const otherPhone = await service.signIn();
    assert.deepEqual(await soulseekOf(service, otherPhone), { account: ana });
  });

  test("an account without one answers none", async () => {
    const service = await harness();
    assert.deepEqual(await soulseekOf(service, await service.signIn()), { account: null });
  });

  test("a new one replaces the one kept", async () => {
    const service = await harness();
    const session = await service.signIn();
    await service.request("PUT", "/v1/soulseek", { session, json: ana });
    const replacement = { username: "amberkite7", password: "fixture-soulseek-password-2" };
    const put = await service.request("PUT", "/v1/soulseek", { session, json: replacement });
    assert.equal(put.status, 204);
    assert.deepEqual(await soulseekOf(service, session), { account: replacement });
  });

  test("an account never sees another account's", async () => {
    const service = await harness();
    await service.request("PUT", "/v1/soulseek", { session: await service.signIn(), json: ana });
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    assert.deepEqual(await soulseekOf(service, bo), { account: null });
  });

  test("the password is kept encrypted, and only SOULSEEK_KEY reads it", async () => {
    const service = await harness();
    const session = await service.signIn();
    await service.request("PUT", "/v1/soulseek", { session, json: ana });

    const rows = (await service.db.execute("SELECT * FROM soulseek_accounts")).rows;
    assert.equal(rows.length, 1);
    const stored = JSON.stringify(rows[0]);
    assert.ok(!stored.includes(ana.password), "the row holds the password");
    assert.ok(
      !Buffer.from(String(rows[0]!.password), "base64").toString("latin1").includes(ana.password),
      "the row holds the password in base64",
    );

    // The same database behind another key: the password doesn't decrypt, so there's none.
    const otherKey = await harness(
      { soulseekKey: Buffer.alloc(32, 9).toString("base64") },
      service.db,
    );
    assert.deepEqual(await soulseekOf(otherKey, session), { account: null });
  });

  test("one Soulseek can't log in with is refused, and the one kept stays", async () => {
    const service = await harness();
    const session = await service.signIn();
    await service.request("PUT", "/v1/soulseek", { session, json: ana });
    for (const body of [
      {},
      { username: "quietfern42" },
      { username: "", password: "x" },
      { username: " padded", password: "x" },
      { username: "a".repeat(31), password: "x" },
      { username: "quietfern42", password: "" },
      { username: "quietfern42", password: 42 },
    ]) {
      const response = await service.request("PUT", "/v1/soulseek", { session, json: body });
      assert.equal(response.status, 400, JSON.stringify(body));
    }
    assert.deepEqual(await soulseekOf(service, session), { account: ana });
  });

  test("both need a session", async () => {
    const service = await harness();
    assert.equal((await service.request("GET", "/v1/soulseek")).status, 401);
    const put = await service.request("PUT", "/v1/soulseek", { session: "not-one", json: ana });
    assert.equal(put.status, 401);
  });

  test("without SOULSEEK_KEY they answer 500 and the other routes still work", async () => {
    const service = await harness({ soulseekKey: null });
    const session = await service.signIn();
    let put: Response | undefined;
    const log = await printed(async () => {
      put = await service.request("PUT", "/v1/soulseek", { session, json: ana });
    });
    assert.equal(put?.status, 500);
    assert.match(log, /SOULSEEK_KEY/);
    assert.equal((await service.request("GET", "/v1/pull", { session })).status, 200);
  });

  test("no route logs the password", async () => {
    const log = await printed(async () => {
      const service = await harness();
      const session = await service.signIn();
      await service.request("PUT", "/v1/soulseek", { session, json: ana });
      await service.request("GET", "/v1/soulseek", { session });
      await service.request("PUT", "/v1/soulseek", {
        session,
        json: { username: " bad", password: ana.password },
      });
      const keyless = await harness({ soulseekKey: null });
      await keyless.request("PUT", "/v1/soulseek", { session: await keyless.signIn(), json: ana });
      await service.request("DELETE", "/v1/account", { session });
    });
    assert.ok(!log.includes(ana.password), log);
  });
});

describe("DELETE /v1/account and the Soulseek account", () => {
  test("deleting the account deletes its Soulseek account, and leaves other accounts'", async () => {
    const service = await harness();
    const session = await service.signIn();
    await service.request("PUT", "/v1/soulseek", { session, json: ana });
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    const bos = { username: "amberkite7", password: "fixture-soulseek-password-2" };
    await service.request("PUT", "/v1/soulseek", { session: bo, json: bos });

    assert.equal((await service.request("DELETE", "/v1/account", { session })).status, 204);
    const rows = (await service.db.execute("SELECT username FROM soulseek_accounts")).rows;
    assert.deepEqual(
      rows.map((row) => row.username),
      ["amberkite7"],
    );

    // Signing in again makes a new account, without the old one's Soulseek account.
    assert.deepEqual(await soulseekOf(service, await service.signIn()), { account: null });
    assert.deepEqual(await soulseekOf(service, bo), { account: bos });
  });
});
