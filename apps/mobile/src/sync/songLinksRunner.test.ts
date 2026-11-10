import assert from "node:assert/strict";
import { test } from "node:test";

import { createSongLinksRunner } from "./songLinksRunner.ts";

test("Turn On answers immediately, then closes and reports fresh links only on returning from settings", async () => {
  for (const handling of ["all", "some", "none"] as const) {
    let currentHandling: "all" | "some" | "none" = "none";
    const events: string[] = [];
    let listener: ((visible: boolean) => void) | undefined;
    const runner = createSongLinksRunner({
      openSettings: async () => {
        events.push("settings");
      },
      subscribeVisibility: (changed) => {
        listener = changed;
        return () => {
          listener = undefined;
        };
      },
      close: () => events.push("closed"),
      answered: () => events.push("answered"),
      readHandling: () => currentHandling,
      report: (state) => events.push(state),
    });
    runner.turnOn();
    runner.turnOn();
    await Promise.resolve();
    assert.deepEqual(events, ["answered", "settings"], "opening settings isn't returning from it");
    listener!(true);
    assert.deepEqual(events, ["answered", "settings"]);
    listener!(false);
    currentHandling = handling;
    listener!(true);
    assert.deepEqual(events, ["answered", "settings", "closed", handling]);
    assert.equal(listener, undefined, "stops following the phone on return");
    runner.answer();
    assert.equal(events.filter((event) => event === "answered").length, 1);
  }
});

test("Not Now, Back or an outside tap closes and answers without visiting settings", () => {
  const events: string[] = [];
  const runner = createSongLinksRunner({
    openSettings: async () => {
      events.push("settings");
    },
    subscribeVisibility: () => {
      events.push("subscribed");
      return () => {};
    },
    close: () => events.push("closed"),
    answered: () => events.push("answered"),
    readHandling: () => "none",
    report: () => events.push("toast"),
  });
  runner.answer();
  runner.answer();
  runner.turnOn();
  assert.deepEqual(events, ["closed", "answered"]);
});

test("a settings launch failure still answers, closes and reports the current links", async () => {
  const events: string[] = [];
  let following = false;
  const runner = createSongLinksRunner({
    openSettings: async () => {
      throw new Error("No settings activity");
    },
    subscribeVisibility: () => {
      following = true;
      return () => {
        following = false;
      };
    },
    close: () => events.push("closed"),
    answered: () => events.push("answered"),
    readHandling: () => "none",
    report: (handling) => events.push(handling),
  });
  runner.turnOn();
  await Promise.resolve();
  assert.deepEqual(events, ["answered", "closed", "none"]);
  assert.equal(following, false);
});
