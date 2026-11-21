import assert from "node:assert/strict";
import { test } from "node:test";
import type { WaveSession } from "@wave/core";
import { accountNameBeforePull } from "./accountNameBeforePull.ts";

const signedIn: WaveSession = {
  status: "signedIn",
  account: { email: "owner@example.com", name: "Owner Name", photoUrl: null },
};

test("repairs a legacy account name before its first pull", async () => {
  const steps: string[] = [];
  await accountNameBeforePull(
    signedIn,
    async (name) => {
      steps.push(`name:${name}`);
      return { type: "done", value: null };
    },
    () => steps.push("pull"),
  );
  assert.deepEqual(steps, ["name:Owner Name", "pull"]);
});

test("a failed name update does not stop the account pull", async () => {
  const steps: string[] = [];
  await accountNameBeforePull(
    signedIn,
    async () => {
      steps.push("name");
      throw new Error("offline");
    },
    () => steps.push("pull"),
  );
  assert.deepEqual(steps, ["name", "pull"]);
});

test("an account with no usable name still starts its pull", async () => {
  const unnamed: WaveSession = {
    ...signedIn,
    account: { ...signedIn.account, name: "   " },
  };
  const steps: string[] = [];
  await accountNameBeforePull(
    unnamed,
    async () => steps.push("name"),
    () => steps.push("pull"),
  );
  assert.deepEqual(steps, ["pull"]);
});
