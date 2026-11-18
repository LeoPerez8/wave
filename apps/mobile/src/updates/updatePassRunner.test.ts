import assert from "node:assert/strict";
import { it } from "node:test";
import type { UpdatePass } from "@wave/core";
import { createUpdatePassRunner } from "./updatePassRunner.ts";

const NOW = Date.UTC(2026, 10, 18);
const DAY = 86_400_000;
const APK = "https://wave-updates.leonardolp2424.workers.dev/v1/apk?channel=ti";
const passFor = (expiresAt: number): UpdatePass => ({
  pass: `1.${expiresAt / 1000}.${"A".repeat(86)}`,
  expiresAt,
});
const PASS = passFor(NOW + 30 * DAY);

it("clears a previous account's credentials and discards its late pass", async () => {
  const previous = Promise.withResolvers<UpdatePass>();
  let calls = 0;
  let stored: { account: string; pass: UpdatePass } | null = null;
  let expoHeaders: Readonly<Record<string, string>> | null = null;
  const runner = createUpdatePassRunner({
    now: () => NOW,
    requestPass: () => (++calls === 1 ? previous.promise : Promise.resolve(PASS)),
    kept: {
      get: () => stored,
      set: (value) => (stored = value),
    },
    channel: "ti",
    setExpoHeaders: (headers) => (expoHeaders = headers),
    warn: assert.fail,
  });

  runner.accountChanged("first");
  const first = runner.refresh();
  runner.accountChanged("second");
  previous.resolve(passFor(NOW + 29 * DAY));
  await first;
  assert.equal(stored, null);
  assert.deepEqual(runner.headersFor(APK), {});
  assert.equal(expoHeaders, null);
  await runner.refresh();
  assert.deepEqual(runner.headersFor(APK), { "wave-update-pass": PASS.pass });

  await runner.withExpoHeaders(async () => {
    assert.deepEqual(expoHeaders, { "expo-channel-name": "ti", "wave-update-pass": PASS.pass });
    runner.accountChanged(null);
    assert.equal(expoHeaders, null);
    assert.equal(stored, null);
    assert.deepEqual(runner.headersFor(APK), {});
  });
});

it("keeps a usable pass through sync failures, then stops sending it at expiration", async () => {
  let now = NOW + 15 * DAY;
  let calls = 0;
  let stored: { account: string; pass: UpdatePass } | null = { account: "first", pass: PASS };
  const runner = createUpdatePassRunner({
    now: () => now,
    requestPass: async () => {
      if (++calls === 1) throw new Error("Sync is unavailable");
      return { pass: null };
    },
    kept: {
      get: () => stored,
      set: (value) => (stored = value),
    },
    channel: "ti",
    setExpoHeaders: () => {},
    warn: assert.fail,
  });

  runner.accountChanged("first");
  await Promise.all([runner.refresh(), runner.refresh()]);
  assert.equal(calls, 1);
  await runner.refresh();
  assert.equal(calls, 1);
  assert.deepEqual(runner.headersFor(APK), { "wave-update-pass": PASS.pass });
  assert.deepEqual(runner.headersFor(APK.replace("/apk?", "/notes?")), {
    "wave-update-pass": PASS.pass,
  });
  for (const other of [
    APK.replace("https:", "http:"),
    APK.replace(".dev/", ".dev.other.test/"),
    APK.replace("/v1/apk?", "/v1/assets?"),
  ]) {
    assert.deepEqual(runner.headersFor(other), {});
  }
  now = PASS.expiresAt;
  await runner.refresh();
  assert.equal(calls, 2);
  assert.deepEqual(runner.headersFor(APK), {});
  assert.equal(stored, null);
});

it("checks for updates on an older APK without giving Expo or the logs the pass", async () => {
  const warnings: string[] = [];
  const overrides: Readonly<Record<string, string>>[] = [];
  const runner = createUpdatePassRunner({
    now: () => NOW,
    requestPass: async () => PASS,
    kept: { get: () => null, set: () => {} },
    channel: "main",
    setExpoHeaders: (headers) => {
      if (headers === null) return;
      overrides.push(headers);
      throw new Error(`Raw Expo exception: ${PASS.pass}`);
    },
    warn: (message) => warnings.push(message),
  });
  runner.accountChanged("first");
  await runner.refresh();
  assert.equal(await runner.withExpoHeaders(async () => "found"), "found");
  assert.equal(await runner.withExpoHeaders(async () => "downloaded"), "downloaded");
  assert.deepEqual(overrides, [{ "expo-channel-name": "main", "wave-update-pass": "none" }]);
  assert.deepEqual(warnings, ["Could not set Expo update request headers"]);
  assert.deepEqual(runner.headersFor(APK), { "wave-update-pass": PASS.pass });
});

it("clears Expo headers when a download fails and replaces errors that could contain the pass", async () => {
  let expoHeaders: Readonly<Record<string, string>> | null = null;
  const runner = createUpdatePassRunner({
    now: () => NOW,
    requestPass: async () => PASS,
    kept: { get: () => null, set: () => {} },
    channel: "ti",
    setExpoHeaders: (headers) => (expoHeaders = headers),
    warn: assert.fail,
  });
  runner.accountChanged("first");
  await runner.refresh();
  await assert.rejects(
    runner.withExpoHeaders(async () => {
      assert.deepEqual(expoHeaders, { "expo-channel-name": "ti", "wave-update-pass": PASS.pass });
      throw new Error(PASS.pass);
    }),
    { message: "Expo update request failed" },
  );
  assert.equal(expoHeaders, null);
});
