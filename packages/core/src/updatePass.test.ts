import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import {
  UPDATE_PASS_HEADER,
  importUpdatePassPublicKeys,
  importUpdatePassSigningKey,
  issueUpdatePass,
  readUpdatePass,
  updatePassHeaders,
  updatePassIsValid,
  updatePassNeedsRenewal,
  updateRequestHeaders,
} from "./index.ts";

// Throwaway pairs made for the test run. Nothing here is Wave's key.
const pair = () =>
  generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
const ours = pair();
const another = pair();

/** A PEM's base64 alone, on one line, as a var would hold it. */
const bare = (pem: string): string => pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");

const DAY = 24 * 60 * 60_000;
const NOW = Date.parse("2026-11-18T09:30:00.000Z");

const issue = async (privateKey = ours.privateKey, now = NOW) =>
  issueUpdatePass(await importUpdatePassSigningKey(privateKey), now);

describe("an update pass", () => {
  it("is valid under its public key until it ends, about 30 days on", async () => {
    const { pass, expiresAt } = await issue();
    const keys = await importUpdatePassPublicKeys(ours.publicKey);
    assert.equal(expiresAt, Date.parse("2026-12-19T00:00:00.000Z"));
    assert.equal(await updatePassIsValid(keys, pass, NOW), true);
    assert.equal(await updatePassIsValid(keys, pass, expiresAt - 1), true);
    assert.equal(await updatePassIsValid(keys, pass, expiresAt), false);
  });

  it("holds its expiry and nothing else, so a day's passes are one text", async () => {
    const morning = await issue(ours.privateKey, Date.parse("2026-11-18T00:00:00.000Z"));
    const night = await issue(ours.privateKey, Date.parse("2026-11-18T23:59:59.000Z"));
    assert.equal(morning.pass, night.pass);
    assert.match(morning.pass, /^1\.\d+\.[A-Za-z0-9_-]{86}$/);
    assert.equal(morning.pass.split(".")[1], String(morning.expiresAt / 1000));
    assert.notEqual((await issue(ours.privateKey, NOW + DAY)).pass, morning.pass);
  });

  it("isn't valid under another key, changed, or when it's no pass at all", async () => {
    const { pass } = await issue();
    const keys = await importUpdatePassPublicKeys(ours.publicKey);
    assert.equal(
      await updatePassIsValid(await importUpdatePassPublicKeys(another.publicKey), pass, NOW),
      false,
    );
    assert.equal(await updatePassIsValid([], pass, NOW), false);
    const [version, expiry, signature] = pass.split(".");
    const later = `${version}.${Number(expiry) + 86_400}.${signature}`;
    assert.equal(await updatePassIsValid(keys, later, NOW), false);
    for (const text of ["", "1", pass.slice(0, -1), `${pass}A`, `2${pass.slice(1)}`, "a.b.c"]) {
      assert.equal(await updatePassIsValid(keys, text, NOW), false, text);
    }
  });

  it("takes keys as PEM or as bare base64, and several public keys at once", async () => {
    const { pass } = await issueUpdatePass(
      await importUpdatePassSigningKey(bare(another.privateKey)),
      NOW,
    );
    const keys = await importUpdatePassPublicKeys(
      `${bare(ours.publicKey)}, ${bare(another.publicKey)}`,
    );
    assert.equal(keys.length, 2);
    assert.equal(await updatePassIsValid(keys, pass, NOW), true);
    assert.equal(await updatePassIsValid(keys, (await issue()).pass, NOW), true);
    assert.deepEqual(await importUpdatePassPublicKeys(" "), []);
    await assert.rejects(importUpdatePassPublicKeys("not a key"));
    await assert.rejects(importUpdatePassSigningKey(ours.publicKey));
  });
});

describe("readUpdatePass", () => {
  it("reads the service's answer and what the app kept of it", async () => {
    const issued = await issue();
    assert.deepEqual(readUpdatePass(JSON.parse(JSON.stringify(issued))), issued);
  });

  it("is null for an answer with no pass", () => {
    for (const answer of [null, {}, { pass: null }, { pass: "x", expiresAt: 1 }, "1.2.3", 7]) {
      assert.equal(readUpdatePass(answer), null);
    }
    assert.equal(readUpdatePass({ pass: `1.1.${"A".repeat(86)}`, expiresAt: "soon" }), null);
  });

  it("rejects an expiry that differs from the one signed in the pass", async () => {
    const issued = await issue();
    assert.equal(readUpdatePass({ ...issued, expiresAt: issued.expiresAt + DAY }), null);
  });
});

describe("update pass renewal", () => {
  const kept = { pass: "p", expiresAt: NOW + 30 * DAY };
  const due = (state: Partial<Parameters<typeof updatePassNeedsRenewal>[0]>) =>
    updatePassNeedsRenewal({ kept: null, lastAttemptAt: null, now: NOW, ...state });

  it("asks for a pass when signed in with none", () => {
    assert.equal(due({}), true);
  });

  it("keeps a pass with more than half its life left, and renews it after", () => {
    assert.equal(due({ kept }), false);
    assert.equal(due({ kept, now: NOW + 15 * DAY - 1 }), false);
    assert.equal(due({ kept, now: NOW + 15 * DAY }), true);
    assert.equal(due({ kept, now: NOW + 40 * DAY }), true);
  });

  it("waits an hour after an ask that brought no pass", () => {
    assert.equal(due({ lastAttemptAt: NOW - 59 * 60_000 }), false);
    assert.equal(due({ lastAttemptAt: NOW - 60 * 60_000 }), true);
    assert.equal(due({ lastAttemptAt: NOW + 60_000 }), true, "a clock set back");
  });
});

describe("what the app sends", () => {
  const kept = { pass: "the-pass", expiresAt: NOW + DAY };

  it("puts the pass on its own asks while it lasts", () => {
    assert.deepEqual(updatePassHeaders(kept, NOW), { [UPDATE_PASS_HEADER]: "the-pass" });
    assert.deepEqual(updatePassHeaders(kept, NOW + DAY), {});
    assert.deepEqual(updatePassHeaders(null, NOW), {});
  });

  it("repeats the channel beside the pass in expo-updates' headers", () => {
    assert.deepEqual(updateRequestHeaders({ channel: "ti", kept, now: NOW }), {
      "expo-channel-name": "ti",
      "wave-update-pass": "the-pass",
    });
  });

  it("leaves the APK's own headers with no pass, an ended one or no channel", () => {
    assert.equal(updateRequestHeaders({ channel: "ti", kept: null, now: NOW }), null);
    assert.equal(updateRequestHeaders({ channel: "ti", kept, now: NOW + DAY }), null);
    assert.equal(updateRequestHeaders({ channel: null, kept, now: NOW }), null);
    assert.equal(updateRequestHeaders({ channel: "", kept, now: NOW }), null);
  });
});
