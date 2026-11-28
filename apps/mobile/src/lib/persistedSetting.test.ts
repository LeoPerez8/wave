import assert from "node:assert/strict";
import { test } from "node:test";

import { loadWithStubs, stubModule } from "../perf/renderHarness.ts";

// A setting that waits before it writes (the Home mix's artist profiles wait up to a minute,
// #1530) still reaches storage when Wave leaves the foreground: Android may then kill Wave
// without a word, and what waited would be lost.

type Phone = {
  stored: Map<string, string>;
  appState: ((state: string) => void)[];
};
const phone: Phone = { stored: new Map(), appState: [] };
Object.assign(globalThis, { __persistedSettingTest: phone });

const [{ persistedSetting }] = await loadWithStubs<[typeof import("./persistedSetting.ts")]>(
  [import.meta.resolve("./persistedSetting.ts")],
  {
    "expo-sqlite/kv-store": stubModule(
      `const phone = globalThis.__persistedSettingTest;
       export const Storage = {
         getItemSync: key => phone.stored.get(key) ?? null,
         setItemSync: (key, value) => { phone.stored.set(key, value); },
         removeItemSync: key => { phone.stored.delete(key); },
       };`,
    ),
    "react-native": stubModule(
      `const phone = globalThis.__persistedSettingTest;
       export const AppState = {
         addEventListener: (_event, listener) => {
           phone.appState.push(listener);
           return { remove: () => {} };
         },
       };`,
    ),
  },
);

const leaveWave = () => {
  for (const listener of phone.appState) listener("background");
};

test("a write waiting for its delay is made when Wave goes to the background", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const profiles = persistedSetting<string>({
    key: "test.profiles",
    read: (stored) => stored ?? "",
    write: (value) => value,
    persistDelayMs: 10_000,
    persistMaxDelayMs: 60_000,
  });
  profiles.set("Amber Ainsley: indie");
  t.mock.timers.tick(5_000);
  assert.equal(phone.stored.get("test.profiles"), undefined);
  leaveWave();
  assert.equal(phone.stored.get("test.profiles"), "Amber Ainsley: indie");
});

test("a write already made isn't made again when Wave leaves", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const profiles = persistedSetting<string>({
    key: "test.written",
    read: (stored) => stored ?? "",
    write: (value) => value,
    persistDelayMs: 10_000,
  });
  profiles.set("first");
  t.mock.timers.tick(10_000);
  assert.equal(phone.stored.get("test.written"), "first");
  phone.stored.set("test.written", "changed elsewhere");
  leaveWave();
  assert.equal(phone.stored.get("test.written"), "changed elsewhere");
});
