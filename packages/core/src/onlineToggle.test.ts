import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readSearchOnline, searchOnlineAlways, writeSearchOnline } from "./index.ts";

describe("the Search online preference", () => {
  test("is Only on demand unless Always was chosen", () => {
    assert.equal(readSearchOnline(null), "onDemand");
    assert.equal(readSearchOnline("something else"), "onDemand");
    assert.equal(readSearchOnline(writeSearchOnline("always")), "always");
    assert.equal(readSearchOnline(writeSearchOnline("onDemand")), "onDemand");
  });

  test("keeps Always search on Wi-Fi", () => {
    assert.equal(readSearchOnline(writeSearchOnline("wifi")), "wifi");
  });

  test("the default keeps nothing on the phone", () => {
    assert.equal(writeSearchOnline("onDemand"), null);
  });
});

describe("whether views search online as Always does", () => {
  const onWifi = { onMobileData: false };
  const onMobileData = { onMobileData: true };

  test("Always does on any network", () => {
    assert.equal(searchOnlineAlways("always", onWifi), true);
    assert.equal(searchOnlineAlways("always", onMobileData), true);
  });

  test("Always on Wi-Fi does off mobile data only", () => {
    assert.equal(searchOnlineAlways("wifi", onWifi), true);
    assert.equal(searchOnlineAlways("wifi", onMobileData), false);
  });

  test("Only on demand never does", () => {
    assert.equal(searchOnlineAlways("onDemand", onWifi), false);
    assert.equal(searchOnlineAlways("onDemand", onMobileData), false);
  });
});
