import assert from "node:assert/strict";
import { test } from "node:test";
import { openTestDatabase, reopenTestDatabase, closeTestDatabase } from "@wave/client/testing";
import { readWindowSettings, changeWindowSettings } from "./windowSettings.ts";

test("window preferences default off, survive reopening, and save only after login registration succeeds", async () => {
  let db = await openTestDatabase();
  db.run("CREATE TABLE desktop_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  assert.deepEqual(readWindowSettings(db), { closeQuits: false, startWithSystem: false });
  let login = false;
  await changeWindowSettings(db, { closeQuits: true, startWithSystem: true }, async (on) => {
    login = on;
  });
  assert.equal(login, true);
  db = await reopenTestDatabase(db);
  assert.deepEqual(readWindowSettings(db), { closeQuits: true, startWithSystem: true });
  await assert.rejects(
    changeWindowSettings(db, { startWithSystem: false }, async () => {
      throw new Error("permission denied");
    }),
  );
  assert.equal(readWindowSettings(db).startWithSystem, true);
  await changeWindowSettings(db, { startWithSystem: false }, async (on) => {
    login = on;
  });
  assert.equal(login, false);
  assert.equal(readWindowSettings(db).closeQuits, true);
  closeTestDatabase(db);
});
