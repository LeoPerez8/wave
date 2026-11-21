import assert from "node:assert/strict";
import { test } from "node:test";
import { closeTestDatabase, openTestDatabase, reopenTestDatabase } from "@wave/client/testing";

import { outputSettings, readOutput, saveOutput } from "./outputDevice.ts";

const speakers = { id: "wasapi:speakers", name: "Speakers" };
const headphones = { id: "wasapi:headphones", name: "Headphones" };

test("the output picked survives a restart, and the system's default is no choice at all", async () => {
  let db = await openTestDatabase();
  db.run("CREATE TABLE desktop_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  assert.equal(readOutput(db), undefined);
  saveOutput(db, headphones);
  db = await reopenTestDatabase(db);
  assert.deepEqual(readOutput(db), headphones);
  saveOutput(db, undefined);
  assert.equal(readOutput(db), undefined);
  db.run("INSERT INTO desktop_settings (key, value) VALUES ('outputDevice', 'not json')");
  assert.equal(readOutput(db), undefined, "a value Wave can't read plays on the default");
  closeTestDatabase(db);
});

test("the output picked is shown by its current name, or as away under the name it had", () => {
  assert.deepEqual(outputSettings([speakers, headphones], undefined), {
    outputs: [speakers, headphones],
    chosen: null,
  });
  const renamed = { id: headphones.id, name: "Studio headphones" };
  assert.deepEqual(outputSettings([speakers, renamed], headphones).chosen, {
    ...renamed,
    connected: true,
  });
  assert.deepEqual(outputSettings([speakers], headphones).chosen, {
    ...headphones,
    connected: false,
  });
});
