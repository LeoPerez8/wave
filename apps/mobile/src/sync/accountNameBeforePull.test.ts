import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccountFields, WaveSession } from "@wave/core";
import { accountNameBeforePull } from "./accountNameBeforePull.ts";

const PHOTO = "https://lh3.googleusercontent.com/a/ACg8ocOwner=s96-c";

const signedIn: WaveSession = {
  status: "signedIn",
  account: { email: "owner@example.com", name: "Owner Name", photoUrl: PHOTO },
};

const withAccount = (name: string | null, photoUrl: string | null): WaveSession => ({
  status: "signedIn",
  account: { email: "owner@example.com", name, photoUrl },
});

/** Runs the step for [session] with a send that keeps what it got, and fails when [failing]. */
const run = async (session: WaveSession, failing = false): Promise<unknown[]> => {
  const steps: unknown[] = [];
  await accountNameBeforePull(
    session,
    async (fields: AccountFields) => {
      steps.push(fields);
      if (failing) throw new Error("offline");
      return { type: "done", value: null };
    },
    () => steps.push("pull"),
  );
  return steps;
};

test("sends a legacy account's name and photo in one request before its first pull", async () => {
  assert.deepEqual(await run(signedIn), [{ name: "Owner Name", photoUrl: PHOTO }, "pull"]);
});

test("an account with no photo sends only its name", async () => {
  assert.deepEqual(await run(withAccount("Owner Name", null)), [{ name: "Owner Name" }, "pull"]);
});

test("an account with no usable name sends only its photo", async () => {
  assert.deepEqual(await run(withAccount("   ", PHOTO)), [{ photoUrl: PHOTO }, "pull"]);
});

test("an account with neither sends nothing and starts its pull at once", async () => {
  assert.deepEqual(await run(withAccount(null, null)), ["pull"]);
  assert.deepEqual(await run({ status: "signedOut" }), ["pull"]);
});

test("a failed send does not stop the account pull", async () => {
  assert.deepEqual(await run(signedIn, true), [{ name: "Owner Name", photoUrl: PHOTO }, "pull"]);
});
