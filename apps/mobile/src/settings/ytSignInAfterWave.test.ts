import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { WaveSession } from "@wave/core";

const boundary = `data:text/javascript,${encodeURIComponent(`
  export const phone = { ytMusicOn: true, yt: { status: "signedOut" }, ytReadFails: false, opened: 0 };
  export const ytMusicEnabled = () => phone.ytMusicOn;
  export const WaveYtMusic = {
    session: async () => {
      if (phone.ytReadFails) throw new Error("no module");
      return phone.yt;
    },
  };
  export const signInToYtMusic = async () => {
    phone.opened += 1;
    return false;
  };
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) return { url: boundary, shortCircuit: true };
    return next(specifier, context);
  },
});
const { ytSignInAfterWave } = await import("./ytSignInAfterWave.ts");
const io = await import(boundary);
hooks.deregister();

const ana: WaveSession = {
  status: "signedIn",
  account: { email: "ana@example.com", name: null, photoUrl: null },
};
const leo = { name: "Leo", email: "leo@example.com", photoUrl: null };

const reset = (): void => {
  Object.assign(io.phone, { ytMusicOn: true, yt: { status: "signedOut" }, ytReadFails: false });
  io.phone.opened = 0;
};

test("a Wave account sign-in opens YT Music's sign-in when it's on and signed out", async () => {
  reset();
  await ytSignInAfterWave(ana);
  assert.equal(io.phone.opened, 1);
});

test("YT Music off, signed in or expired stops after the Wave account", async () => {
  for (const change of [
    { ytMusicOn: false },
    { yt: { status: "signedIn", account: leo } },
    { yt: { status: "expired", account: leo } },
  ]) {
    reset();
    Object.assign(io.phone, change);
    await ytSignInAfterWave(ana);
    assert.equal(io.phone.opened, 0, JSON.stringify(change));
  }
});

test("a Wave session that isn't signed in opens nothing", async () => {
  reset();
  await ytSignInAfterWave({ status: "signedOut" });
  assert.equal(io.phone.opened, 0);
});

test("a YT Music session that can't be read opens nothing and doesn't reject", async () => {
  reset();
  io.phone.ytReadFails = true;
  await ytSignInAfterWave(ana);
  assert.equal(io.phone.opened, 0);
});
