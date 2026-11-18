import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createClient } from "@libsql/client";
import { activationBlockers, compatibilityReport } from "./compatibility.ts";
import { favorite, harness, pull, push } from "./testing.ts";
import { migrate } from "./migrations.ts";
import { watchUsage } from "./usage.ts";

const revision = "a".repeat(40);
const at = Date.UTC(2026, 10, 17, 21);

test("without the database the report is dated insufficient evidence, never a pass", async () => {
  const report = await compatibilityReport({
    environment: "production-sync",
    source: "live",
    sourceRevision: revision,
    now: at,
  });
  assert.equal(report.result, "insufficient-evidence");
  assert.equal(report.environment, "production-sync");
  assert.equal(report.source, "live");
  assert.equal(report.sourceRevision, revision);
  assert.equal(report.observedAt, "2026-11-17T21:00:00.000Z");
  assert.equal(report.inventory, null);
  assert.ok(report.findings.some((finding) => finding.code === "inventory-unavailable"));
});

test("current use is counted, tombstones included, without naming or changing anything", async () => {
  const service = await harness();
  // Ana on two phones, Bia on one: two account places, three sessions.
  const phoneA = await service.signIn();
  const phoneB = await service.signIn();
  const bia = await service.signIn({ sub: "google-sub-2", email: "bia@example.com" });
  await push(service, phoneA, {
    favorites: [favorite("private-key-1", 1), favorite("removed-key", 2, { deleted: true })],
  });
  const before = await pull(service, phoneB);

  const report = await compatibilityReport({
    db: service.db,
    environment: "local-sync",
    source: "fixture",
    sourceRevision: revision,
    now: service.now,
  });

  assert.deepEqual(report.inventory?.accounts, { count: 2, limit: 10, headroom: 8 });
  const [first, second] = report.inventory?.perAccount ?? [];
  assert.equal(first?.label, "account-1");
  assert.equal(second?.label, "account-2");
  assert.deepEqual(first?.sessions, { valid: 2, expired: 0, limit: 10, headroom: 8 });
  assert.deepEqual(second?.sessions, { valid: 1, expired: 0, limit: 10, headroom: 9 });
  assert.deepEqual(first?.retained.favorites, {
    live: 1,
    tombstones: 1,
    retained: 2,
    limit: 100_000,
    headroom: 99_998,
  });
  assert.deepEqual(first?.retained.preferences, {
    live: 0,
    tombstones: 0,
    retained: 0,
    limit: 200,
    headroom: 200,
  });
  assert.equal(Object.keys(first?.retained ?? {}).length, 10);
  // Nothing in the way, but the installed app hasn't been seen to work yet.
  assert.equal(report.result, "insufficient-evidence");
  assert.ok(!report.findings.some((finding) => finding.code === "inventory-unavailable"));
  assert.deepEqual(
    report.findings.filter((finding) => finding.code === "installed-client-unverified").length,
    4,
  );

  const serialized = JSON.stringify(report);
  for (const secret of [
    phoneA,
    phoneB,
    bia,
    "ana@example.com",
    "google-sub",
    "private-key-1",
    "removed-key",
  ]) {
    assert.ok(!serialized.includes(secret), `the report holds ${secret}`);
  }
  // Every phone is still signed in to the same account with the same Library.
  assert.deepEqual(await pull(service, phoneA), before);
  assert.deepEqual(await pull(service, phoneB), before);
  assert.equal((await pull(service, bia)).favorites.length, 0);
});

test("with the installed app seen working and nothing in the way, the report is compatible", async () => {
  const service = await harness();
  await service.signIn();
  const report = await compatibilityReport({
    db: service.db,
    environment: "local-sync",
    source: "fixture",
    now: service.now,
    installedClient: {
      "sign-in": "passed",
      "push-pull": "passed",
      "library-preserved": "passed",
      "sessions-preserved": "passed",
    },
  });
  assert.equal(report.result, "compatible");
  assert.deepEqual(report.findings, []);
  assert.equal(report.sourceRevision, null);
});

const preference = (id: string, deleted: boolean) => ({
  id,
  changedAt: 1,
  phoneId: "phone-a",
  deleted,
  value: deleted ? null : "on",
});

test("excesses the limits would meet are flagged, and nothing is evicted, revoked or deleted", async () => {
  // Accounts and sessions made before the limits were switched on.
  const service = await harness({
    limits: { maxAccounts: 100, maxNewAccountsPerDay: 100, maxSignInsPerMinute: 100 },
  });
  // account-1: ten phones, so its next sign-in would be refused.
  const full: string[] = [];
  for (let i = 0; i < 10; i++) full.push(await service.signIn());
  // account-2: eleven phones from before the limit, and 150 preferences beside 60 tombstones.
  const over: string[] = [];
  for (let i = 0; i < 11; i++) over.push(await service.signIn({ sub: "sub-over" }));
  const preferences = Array.from({ length: 210 }, (_, i) => preference(`pref-${i}`, i >= 150));
  await push(service, over[0]!, { preferences });
  // Nine more accounts: eleven in all.
  for (let i = 0; i < 9; i++) await service.signIn({ sub: `sub-${i}` });
  const before = await pull(service, over[0]!);

  const report = await compatibilityReport({
    db: service.db,
    environment: "local-sync",
    source: "fixture",
    now: service.now,
    installedClient: {
      "sign-in": "passed",
      "push-pull": "passed",
      "library-preserved": "passed",
      "sessions-preserved": "passed",
    },
  });

  assert.equal(report.result, "incompatible");
  assert.deepEqual(report.inventory?.accounts, { count: 11, limit: 10, headroom: -1 });
  assert.deepEqual(
    report.findings.map(({ code, account, subject }) => ({ code, account, subject })),
    [
      { code: "accounts-over-limit", account: undefined, subject: undefined },
      { code: "sessions-full", account: "account-1", subject: undefined },
      { code: "sessions-over-limit", account: "account-2", subject: undefined },
      { code: "retained-over-limit", account: "account-2", subject: "preferences" },
    ],
  );
  assert.deepEqual(report.inventory?.perAccount[1]?.retained.preferences, {
    live: 150,
    tombstones: 60,
    retained: 210,
    limit: 200,
    headroom: -10,
  });

  // Every phone of every account still works, with its data.
  for (const session of [...full, ...over]) await pull(service, session);
  assert.deepEqual(await pull(service, over[10]!), before);
  assert.equal(before.preferences.length, 210);
});

test("the installed app failing a check makes the report incompatible", async () => {
  const service = await harness();
  await service.signIn();
  const report = await compatibilityReport({
    db: service.db,
    environment: "local-sync",
    source: "fixture",
    now: service.now,
    installedClient: { "sign-in": "passed", "push-pull": "failed" },
  });
  assert.equal(report.result, "incompatible");
  assert.deepEqual(
    report.findings.map(({ code, subject }) => `${code} ${subject}`),
    [
      "installed-client-failed push-pull",
      "installed-client-unverified library-preserved",
      "installed-client-unverified sessions-preserved",
    ],
  );
});

const DAY_MS = 24 * 60 * 60 * 1000;

test("operational records are counted against their lifecycles", async () => {
  const service = await harness();
  const session = await service.signIn();
  await service.request("GET", "/v1/genius/search?q=a", { session });
  // The hourly watch failing to read Cloudflare once a day, for 31 days.
  const start = service.now;
  for (let day = 0; day < 31; day++) {
    await watchUsage({
      db: service.db,
      secrets: { CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_ANALYTICS_TOKEN: "token" },
      fetch: async () => new Response("{}", { status: 500 }),
      now: () => start + day * DAY_MS,
      warn: () => {},
    });
  }
  // With the sign-in's counter for the account, attempts from 999 addresses fill this minute's 1,000.
  for (let i = 0; i < 999; i++) {
    await service.request("POST", "/v1/session", {
      headers: { "cf-connecting-ip": `10.0.${i >> 8}.${i & 255}` },
    });
  }
  service.now = start + 30 * DAY_MS;
  const options = {
    db: service.db,
    environment: "local-sync",
    source: "fixture",
    installedClient: {
      "sign-in": "passed",
      "push-pull": "passed",
      "library-preserved": "passed",
      "sessions-preserved": "passed",
    },
  } as const;

  const full = await compatibilityReport({ ...options, now: service.now - 30 * DAY_MS });
  assert.deepEqual(full.inventory?.authCounters, {
    current: 1_000,
    stale: 0,
    limit: 1_000,
    headroom: 0,
  });
  assert.equal(full.result, "incompatible");
  assert.deepEqual(
    full.findings.map((finding) => finding.code),
    ["auth-counters-full"],
  );

  // A day after the watch last ran, before its next run: it kept 30 days, one of them now too old.
  // The counters are stale: the next sign-in clears them.
  const later = await compatibilityReport({ ...options, now: service.now + DAY_MS });
  assert.deepEqual(later.inventory?.authCounters, {
    current: 0,
    stale: 1_000,
    limit: 1_000,
    headroom: 1_000,
  });
  assert.deepEqual(later.inventory?.usageWarnings, { retained: 30, outsideWindow: 1, limit: 60 });
  assert.deepEqual(later.inventory?.providerUsage, {
    rows: 1,
    mostPerAccount: 1,
    limitPerAccount: 3,
  });
  assert.equal(later.result, "compatible");
});

test("only a fresh, compatible report of the deployed service for the revision being switched on authorizes it", async () => {
  const service = await harness();
  await service.signIn();
  const observed = (source: "live" | "fixture") =>
    compatibilityReport({
      db: service.db,
      environment: "production-sync",
      source,
      sourceRevision: revision,
      now: service.now,
      installedClient: {
        "sign-in": "passed",
        "push-pull": "passed",
        "library-preserved": "passed",
        "sessions-preserved": "passed",
      },
    });
  const live = await observed("live");
  const minutes = (n: number) => service.now + n * 60_000;

  assert.deepEqual(activationBlockers(live, { now: minutes(10), sourceRevision: revision }), []);
  assert.deepEqual(activationBlockers(live, { now: minutes(61), sourceRevision: revision }), [
    "report-stale",
  ]);
  assert.deepEqual(activationBlockers(live, { now: minutes(10), sourceRevision: "b".repeat(40) }), [
    "revision-mismatch",
  ]);
  assert.deepEqual(
    activationBlockers(await observed("fixture"), { now: minutes(10), sourceRevision: revision }),
    ["not-live"],
  );
  const pending = await compatibilityReport({
    environment: "production-sync",
    source: "live",
    now: service.now,
  });
  assert.deepEqual(activationBlockers(pending, { now: minutes(1), sourceRevision: revision }), [
    "result-insufficient-evidence",
    "revision-mismatch",
  ]);
  // A report dated after the moment of activation isn't one taken before it.
  assert.deepEqual(activationBlockers(live, { now: minutes(-1), sourceRevision: revision }), [
    "report-stale",
  ]);
});

/** Runs the operator's command with [env] added to a database-free environment. */
const runCommand = (args: readonly string[], env: Readonly<Record<string, string>> = {}) => {
  const { TURSO_DATABASE_URL: _url, TURSO_AUTH_TOKEN: _token, ...rest } = process.env;
  const run = spawnSync(process.execPath, ["scripts/compatibility-report.ts", ...args], {
    cwd: join(import.meta.dirname, ".."),
    env: { ...rest, ...env },
    encoding: "utf8",
  });
  return {
    status: run.status,
    report: JSON.parse(run.stdout) as Record<string, unknown>,
    stderr: run.stderr,
  };
};

test("the operator's command reports insufficient evidence when it can't reach the database", () => {
  const run = runCommand(["--environment", "production-sync", "--revision", revision]);
  assert.equal(run.status, 2);
  assert.equal(run.report.result, "insufficient-evidence");
  assert.equal(run.report.environment, "production-sync");
  assert.equal(run.report.source, "live");
  assert.equal(run.report.sourceRevision, revision);
  assert.equal(run.report.inventory, null);
});

test("the operator's command counts the database it's given and passes on the owner's observations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wave-compat-"));
  const url = `file:${join(dir, "sync.db").replaceAll("\\", "/")}`;
  const db = createClient({ url });
  after(() => {
    db.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can hold the file a moment after closing; it's a temp dir.
    }
  });
  await migrate(db);
  const service = await harness({}, db);
  service.now = Date.now();
  await service.signIn();

  const run = runCommand(
    [
      "--environment",
      "staging-sync",
      "--source",
      "fixture",
      "--installed-client",
      "sign-in=passed,push-pull=passed,library-preserved=passed,sessions-preserved=passed",
    ],
    { TURSO_DATABASE_URL: url },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.report.result, "compatible");
  assert.equal(run.report.source, "fixture");
  assert.deepEqual((run.report.inventory as { accounts: unknown }).accounts, {
    count: 1,
    limit: 10,
    headroom: 9,
  });
  assert.ok(!JSON.stringify(run.report).includes("ana@example.com"));
  assert.ok(!JSON.stringify(run.report).includes(url));
});

test("a category at its quota with tombstones counted is flagged: its next new id would be refused", async () => {
  const service = await harness();
  const session = await service.signIn();
  const preferences = Array.from({ length: 200 }, (_, i) => preference(`pref-${i}`, i >= 150));
  await push(service, session, { preferences });
  const report = await compatibilityReport({
    db: service.db,
    environment: "local-sync",
    source: "fixture",
    now: service.now,
  });
  assert.equal(report.result, "incompatible");
  assert.deepEqual(report.findings[0], {
    code: "retained-full",
    account: "account-1",
    subject: "preferences",
    count: 200,
    limit: 200,
  });
});

test("a session unused for 90 days is counted as expired, apart from the valid ones", async () => {
  const service = await harness();
  await service.signIn();
  service.now += 60 * DAY_MS;
  const phone = await service.signIn();
  // The first phone's session is now 91 days unused; the second's 31.
  service.now += 31 * DAY_MS;
  const report = await compatibilityReport({
    db: service.db,
    environment: "local-sync",
    source: "fixture",
    now: service.now,
  });
  assert.deepEqual(report.inventory?.perAccount[0]?.sessions, {
    valid: 1,
    expired: 1,
    limit: 10,
    headroom: 9,
  });
  await pull(service, phone);
});
