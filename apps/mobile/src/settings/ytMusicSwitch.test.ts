import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, test } from "node:test";

import { stubModule } from "../perf/reactCompilerBuilds.ts";

/**
 * Settings' Use YT Music switch, with the setting, the alert and the Wave
 * account stubbed: each stub writes what it was asked to
 * `globalThis.ytMusicSwitchTest`, and the test sets the answers.
 */
interface SwitchTest {
  readonly calls: string[];
  /** Whether the alert's action is chosen. */
  confirm: boolean;
  /** Whether this phone is signed in to a Wave account. */
  signedIn: boolean;
}
const shared: SwitchTest = { calls: [], confirm: true, signedIn: false };
Object.assign(globalThis, { ytMusicSwitchTest: shared });

const core = JSON.stringify(import.meta.resolve("@wave/core"));
const stubs: Record<string, string> = {
  "@/localisation/localisation": stubModule(`
    import { catalogueOf } from ${core};
    export const currentLocalisation = () => ({ language: "en", strings: catalogueOf("en") });
  `),
  "@/overlay/alert": stubModule(`
    const t = globalThis.ytMusicSwitchTest;
    export const confirmAction = async (spec) => {
      t.calls.push("ask " + spec.title + " | " + spec.message.split("\\n").at(-1) + " | " + spec.action.label);
      return t.confirm;
    };
  `),
  "@/sync/waveSignedIn": stubModule(`
    export const waveSignedIn = async () => globalThis.ytMusicSwitchTest.signedIn;
  `),
  "./ytMusic": stubModule(`
    export const setYtMusicEnabled = (on) => globalThis.ytMusicSwitchTest.calls.push("set " + on);
  `),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = stubs[specifier];
    if (stub !== undefined) return { url: stub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { switchYtMusic } = await import("./ytMusicSwitch.ts");

beforeEach(() => {
  shared.calls.length = 0;
  shared.confirm = true;
  shared.signedIn = false;
});

test("turning it on asks nothing", async () => {
  await switchYtMusic(true);
  assert.deepEqual(shared.calls, ["set true"]);
});

test("turning it off asks first, and Turn Off turns it off", async () => {
  await switchYtMusic(false);
  assert.deepEqual(shared.calls, [
    "ask Turn Off YT Music? | Downloaded songs keep playing and nothing is deleted. | Turn Off",
    "set false",
  ]);
});

test("Cancel keeps it on", async () => {
  shared.confirm = false;
  await switchYtMusic(false);
  assert.equal(shared.calls.length, 1);
  assert.ok(!shared.calls.some((call) => call.startsWith("set")));
});

test("signed in to a Wave account, the warning says every phone turns it off", async () => {
  shared.signedIn = true;
  await switchYtMusic(false);
  assert.equal(
    shared.calls[0],
    "ask Turn Off YT Music? | This applies to every phone signed in to your Wave account. | Turn Off",
  );
});
