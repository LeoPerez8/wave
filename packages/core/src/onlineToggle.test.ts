import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readSearchOnline, writeSearchOnline } from "./index.ts";

describe("the Search online preference", () => {
  test("is Only on demand unless Always was chosen", () => {
    assert.equal(readSearchOnline(null), "onDemand");
    assert.equal(readSearchOnline("something else"), "onDemand");
    assert.equal(readSearchOnline(writeSearchOnline("always")), "always");
    assert.equal(readSearchOnline(writeSearchOnline("onDemand")), "onDemand");
  });

  test("the default keeps nothing on the phone", () => {
    assert.equal(writeSearchOnline("onDemand"), null);
  });
});
