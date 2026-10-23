import assert from "node:assert/strict";
import test from "node:test";
import { artistPageOpening } from "./artistPageOpening.ts";

test("an offline artist destination has first-frame content and starts no request, even with no Library finder", () => {
  const page = artistPageOpening({ online: false, enabled: true });
  assert.equal(page.request, false);
  assert.equal(page.view?.note, "offline");
  assert.deepEqual(page.view?.songs, []);
  assert.equal(artistPageOpening({ online: true, enabled: true }).view, null);
});
