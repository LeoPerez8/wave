import assert from "node:assert/strict";
import { test } from "node:test";
import { openTestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";

import { createKaraokeSwitch } from "./karaoke.ts";

/** The switch over a fresh device store; `restarted` reads the same store as a new app would. */
const karaokeOver = async () => {
  const db = await openTestDatabase();
  db.run(
    sql`CREATE TABLE IF NOT EXISTS desktop_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );
  return { karaoke: createKaraokeSwitch(db), restarted: () => createKaraokeSwitch(db) };
};

test("Karaoke is off until it's turned on, and stays on for a new app", async () => {
  const { karaoke, restarted } = await karaokeOver();
  assert.equal(karaoke.on(), false);
  karaoke.setOn(true);
  assert.equal(karaoke.on(), true);
  assert.equal(restarted().on(), true);
});

test("Karaoke turned off stays off for a new app", async () => {
  const { karaoke, restarted } = await karaokeOver();
  karaoke.setOn(true);
  karaoke.setOn(false);
  assert.equal(karaoke.on(), false);
  assert.equal(restarted().on(), false);
});
