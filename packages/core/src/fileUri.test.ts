import assert from "node:assert/strict";
import { test } from "node:test";

import { fileUri } from "./fileUri.ts";

test("cached files become URIs and existing remote or content addresses stay intact", () => {
  assert.equal(fileUri("/covers/a b.jpg"), "file:///covers/a b.jpg");
  assert.equal(fileUri("file:///covers/a.jpg"), "file:///covers/a.jpg");
  assert.equal(fileUri("https://covers.example/a.jpg"), "https://covers.example/a.jpg");
  assert.equal(fileUri("content://photos/1"), "content://photos/1");
  assert.equal(fileUri(null), undefined);
  assert.equal(fileUri(undefined), undefined);
  assert.equal(fileUri(""), undefined);
});
