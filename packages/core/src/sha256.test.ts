import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Hex } from "./index.ts";

describe("sha256Hex", () => {
  it("gives a text's SHA-256 in lowercase hex", async () => {
    assert.equal(
      await sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    assert.equal(
      await sha256Hex(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
