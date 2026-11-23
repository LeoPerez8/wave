import assert from "node:assert/strict";
import { test } from "node:test";
import type { WaveSession } from "@wave/core";
import { accountNameBeforePull } from "./accountNameBeforePull.ts";

const PHOTO = "https://lh3.googleusercontent.com/a/ACg8ocOwner=s96-c";

const signedIn: WaveSession = {
  status: "signedIn",
  account: { email: "owner@example.com", name: "Owner Name", photoUrl: PHOTO },
};

/** Runs the step for [session] with sends that keep what they got, or fail when [failing] names them. */
const run = async (
  session: WaveSession,
  failing: readonly ("name" | "photo")[] = [],
): Promise<string[]> => {
  const steps: string[] = [];
  const send = (kind: "name" | "photo") => async (value: string) => {
    steps.push(`${kind}:${value}`);
    if (failing.includes(kind)) throw new Error("offline");
    return { type: "done", value: null };
  };
  await accountNameBeforePull(session, { name: send("name"), photo: send("photo") }, () =>
    steps.push("pull"),
  );
  return steps;
};

test("repairs a legacy account's name and photo before its first pull", async () => {
  assert.deepEqual(await run(signedIn), ["name:Owner Name", `photo:${PHOTO}`, "pull"]);
});

test("a failed send, of either or both, does not stop the account pull", async () => {
  for (const failing of [["name"], ["photo"], ["name", "photo"]] as const)
    assert.deepEqual(await run(signedIn, failing), ["name:Owner Name", `photo:${PHOTO}`, "pull"]);
});

test("an account with no photo sends only its name", async () => {
  const noPhoto: WaveSession = { ...signedIn, account: { ...signedIn.account, photoUrl: null } };
  assert.deepEqual(await run(noPhoto), ["name:Owner Name", "pull"]);
});

test("an account with no usable name still sends its photo and starts its pull", async () => {
  const unnamed: WaveSession = { ...signedIn, account: { ...signedIn.account, name: "   " } };
  assert.deepEqual(await run(unnamed), [`photo:${PHOTO}`, "pull"]);
});

test("an account with neither starts its pull at once", async () => {
  const bare: WaveSession = {
    ...signedIn,
    account: { ...signedIn.account, name: null, photoUrl: null },
  };
  assert.deepEqual(await run(bare), ["pull"]);
});
