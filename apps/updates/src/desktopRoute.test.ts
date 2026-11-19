import assert from "node:assert/strict";
import { test } from "node:test";
import { createUpdateService } from "./service.ts";
import { memoryStorage } from "./testing.ts";

test("desktop latest and immutable artifacts resolve only within their channel", async () => {
  const digest = "a".repeat(128);
  const installer = `files/0.71.0-ti/${digest}/wave-0.71.0-ti-win-x64.exe`;
  const storage = memoryStorage();
  await storage.put("desktop/ti/latest.json", '{"win32":{"payload":"signed"}}', "application/json");
  await storage.put(`desktop/ti/${installer}`, "installer", "application/octet-stream");
  const service = createUpdateService(storage);
  const get = (path: string) => service.fetch(new Request(`https://wave.test/v1/desktop/${path}`));
  const latest = await get("ti/latest.json");
  assert.equal(latest.status, 200);
  assert.equal(latest.headers.get("cache-control"), "no-store");
  assert.equal((await latest.json()).win32.payload, "signed");
  const file = await get(`ti/${installer}`);
  assert.equal(file.status, 200);
  assert.equal(await file.text(), "installer");
  const partial = await service.fetch(
    new Request(`https://wave.test/v1/desktop/ti/${installer}`, {
      headers: { range: "bytes=2-4" },
    }),
  );
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 2-4/9");
  assert.equal(await partial.text(), "sta");
  assert.equal((await get(`main/${installer}`)).status, 404);
  assert.equal((await get("ti/versions/0.71.0-ti.json")).status, 404);
  assert.equal((await get("ti/files/0.71.0-ti/config.json")).status, 404);
});
