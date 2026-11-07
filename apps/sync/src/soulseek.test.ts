import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { migrate } from "./migrations.ts";
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

describe("Soulseek key versions", () => {
  const first = Buffer.alloc(32, 7).toString("base64");
  const second = Buffer.alloc(32, 11).toString("base64");

  test("a password kept under an older key still reads after a new key is added", async () => {
    const before = await harness({ soulseekKeys: { SOULSEEK_KEY: first } });
    const session = await before.signIn();
    await before.request("PUT", "/v1/soulseek", { session, json: ana });

    const rotated = await harness(
      { soulseekKeys: { SOULSEEK_KEY: first, SOULSEEK_KEY_2: second } },
      before.db,
    );
    assert.deepEqual(await soulseekOf(rotated, session), { account: ana });
  });

  test("after a new key is added, passwords are kept under it", async () => {
    const rotated = await harness({
      soulseekKeys: { SOULSEEK_KEY: first, SOULSEEK_KEY_2: second },
    });
    const session = await rotated.signIn();
    await rotated.request("PUT", "/v1/soulseek", { session, json: ana });

    const onlySecond = await harness({ soulseekKeys: { SOULSEEK_KEY_2: second } }, rotated.db);
    assert.deepEqual(await soulseekOf(onlySecond, session), { account: ana });
    const onlyFirst = await harness({ soulseekKeys: { SOULSEEK_KEY: first } }, rotated.db);
    assert.deepEqual(await soulseekOf(onlyFirst, session), { account: null });
  });

  test("upgrading an existing database keeps its passwords under the first key", async () => {
    const before = await harness({ soulseekKeys: { SOULSEEK_KEY: first } });
    const session = await before.signIn();
    await before.request("PUT", "/v1/soulseek", { session, json: ana });
    // Recreate the deployed schema with a kept password, before migration 0010.
    await before.db.batch(
      [
        "ALTER TABLE soulseek_accounts DROP COLUMN key_version",
        "DELETE FROM migrations WHERE id = '0010_soulseek_key_version'",
      ],
      "write",
    );

    assert.deepEqual(await migrate(before.db), ["0010_soulseek_key_version"]);
    const rotated = await harness(
      { soulseekKeys: { SOULSEEK_KEY: first, SOULSEEK_KEY_2: second } },
      before.db,
    );
    assert.deepEqual(await soulseekOf(rotated, session), { account: ana });
  });

  test("a password read under an older key moves to the current one", async () => {
    const before = await harness({ soulseekKeys: { SOULSEEK_KEY: first } });
    const session = await before.signIn();
    await before.request("PUT", "/v1/soulseek", { session, json: ana });
    const rotated = await harness(
      { soulseekKeys: { SOULSEEK_KEY: first, SOULSEEK_KEY_2: second } },
      before.db,
    );
    await soulseekOf(rotated, session);

    const retired = await harness({ soulseekKeys: { SOULSEEK_KEY_2: second } }, before.db);
    assert.deepEqual(await soulseekOf(retired, session), { account: ana });
  });

  test("a password doesn't read with another version's key, or as another account's", async () => {
    const rotated = await harness({
      soulseekKeys: { SOULSEEK_KEY: first, SOULSEEK_KEY_2: second },
    });
    const session = await rotated.signIn();
    await rotated.request("PUT", "/v1/soulseek", { session, json: ana });

    // The current key's value, but held as version 1: no row is read under the wrong version.
    const relabelled = await harness({ soulseekKeys: { SOULSEEK_KEY: second } }, rotated.db);
    assert.deepEqual(await soulseekOf(relabelled, session), { account: null });
    const otherSecond = await harness(
      {
        soulseekKeys: {
          SOULSEEK_KEY: first,
          SOULSEEK_KEY_2: Buffer.alloc(32, 13).toString("base64"),
        },
      },
      rotated.db,
    );
    assert.deepEqual(await soulseekOf(otherSecond, session), { account: null });

    // Ana's sealed password copied onto Bo's row doesn't open for Bo.
    const bo = await rotated.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    await rotated.request("PUT", "/v1/soulseek", {
      session: bo,
      json: { username: "amberkite7", password: "fixture-soulseek-password-2" },
    });
    await rotated.db.execute(
      `UPDATE soulseek_accounts
         SET (password, key_version) =
           (SELECT password, key_version FROM soulseek_accounts WHERE username = 'quietfern42')
       WHERE username = 'amberkite7'`,
    );
    assert.deepEqual(await soulseekOf(rotated, bo), { account: null });
  });

  test("a key under a name that isn't a version, or that isn't 32 bytes, answers 500", async () => {
    for (const soulseekKeys of [
      { SOULSEEK_KEY: first, SOULSEEK_KEY_1: second },
      { SOULSEEK_KEY: first, SOULSEEK_KEY_NEW: second },
      { SOULSEEK_KEY: first, SOULSEEK_KEY_2: "c2hvcnQ=" },
    ]) {
      const service = await harness({ soulseekKeys });
      const session = await service.signIn();
      let put: Response | undefined;
      await printed(async () => {
        put = await service.request("PUT", "/v1/soulseek", { session, json: ana });
      });
      assert.equal(put?.status, 500, JSON.stringify(Object.keys(soulseekKeys)));
    }
  });

  test("no line logged around a new key holds a password or a key", async () => {
    const keys = [first, second, "c2hvcnQ="];
    const log = await printed(async () => {
      const before = await harness({ soulseekKeys: { SOULSEEK_KEY: first } });
      const session = await before.signIn();
      await before.request("PUT", "/v1/soulseek", { session, json: ana });
      const rotated = await harness(
        { soulseekKeys: { SOULSEEK_KEY: first, SOULSEEK_KEY_2: second } },
        before.db,
      );
      await rotated.request("GET", "/v1/soulseek", { session });
      await rotated.request("PUT", "/v1/soulseek", { session, json: ana });
      const misnamed = await harness(
        { soulseekKeys: { SOULSEEK_KEY: first, SOULSEEK_KEY_X: second } },
        before.db,
      );
      await misnamed.request("GET", "/v1/soulseek", { session });
      const short = await harness(
        { soulseekKeys: { SOULSEEK_KEY: first, SOULSEEK_KEY_2: keys[2]! } },
        before.db,
      );
      await short.request("GET", "/v1/soulseek", { session });
    });
    assert.match(log, /SOULSEEK_KEY_X/);
    assert.ok(!log.includes(ana.password), log);
    for (const key of keys) assert.ok(!log.includes(key), log);
  });
});
