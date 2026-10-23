import assert from "node:assert/strict";
import test from "node:test";

import { createAllFilesAccess } from "./allFilesAccess.ts";

test("a failed settings launch stays recoverable and a retry can grant access", async () => {
  let granted = false;
  let attempts = 0;
  const access = createAllFilesAccess({
    hasAccess: () => granted,
    openSettings: async () => {
      if (++attempts === 1) throw new Error("No settings activity");
    },
  });
  await access.request();
  assert.deepEqual(access.get(), {
    granted: false,
    denied: false,
    opening: false,
    failed: true,
  });
  await access.request();
  assert.equal(access.get().failed, false);
  granted = true;
  access.recheck();
  assert.deepEqual(access.get(), {
    granted: true,
    denied: false,
    opening: false,
    failed: false,
  });
  assert.equal(attempts, 2);
});

test("return without a grant explains denial; a later grant and revocation are rechecked", async () => {
  let granted = false;
  const access = createAllFilesAccess({
    hasAccess: () => granted,
    openSettings: async () => {},
  });
  access.recheck();
  assert.equal(access.get().denied, false);
  await access.request();
  assert.equal(access.get().denied, false); // Launching settings is not a denial.
  access.recheck();
  assert.equal(access.get().denied, true);
  access.recheck();
  assert.equal(access.get().denied, true);
  granted = true;
  access.recheck();
  assert.equal(access.get().granted, true);
  assert.equal(access.get().denied, false);
  granted = false;
  access.recheck();
  assert.equal(access.get().granted, false);
});

test("repeated taps launch settings only once while Android answers", async () => {
  let launches = 0;
  let finish!: () => void;
  const access = createAllFilesAccess({
    hasAccess: () => false,
    openSettings: () => {
      launches++;
      return new Promise<void>((resolve) => (finish = resolve));
    },
  });
  const first = access.request();
  assert.equal(access.get().opening, true);
  await access.request();
  assert.equal(launches, 1);
  finish();
  await first;
  assert.equal(access.get().opening, false);
});

test("an unchanged foreground permission check does not notify either access consumer", () => {
  const access = createAllFilesAccess({
    hasAccess: () => true,
    openSettings: async () => {},
  });
  const initial = access.get();
  let notifications = 0;
  const unsubscribe = access.subscribe(() => notifications++);
  access.recheck();
  assert.equal(access.get(), initial);
  assert.equal(notifications, 0);
  unsubscribe();
});
