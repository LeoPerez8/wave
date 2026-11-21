import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ACCOUNT_NAME_MAX_LENGTH, accountName } from "./index.ts";

describe("accountName", () => {
  test("keeps a name as it is written", () => {
    assert.equal(accountName("Ana Souza"), "Ana Souza");
  });

  test("drops the space around a name and joins the runs of space inside it", () => {
    assert.equal(accountName("  Ana \t\n  Souza "), "Ana Souza");
  });

  test("gives none for an empty name or one of only space", () => {
    assert.equal(accountName(""), null);
    assert.equal(accountName(" \n "), null);
  });

  test("gives none for anything but text", () => {
    assert.equal(accountName(undefined), null);
    assert.equal(accountName(null), null);
    assert.equal(accountName(42), null);
    assert.equal(accountName({ name: "Ana" }), null);
  });

  test("takes control characters for space", () => {
    assert.equal(accountName("Ana\u0000Souza\u0007"), "Ana Souza");
  });

  test("cuts a name past the longest one to that many characters", () => {
    assert.equal(ACCOUNT_NAME_MAX_LENGTH, 100);
    assert.equal(accountName("a".repeat(101)), "a".repeat(100));
    assert.equal(accountName("a".repeat(100)), "a".repeat(100));
  });

  test("counts a character outside the basic plane once and never cuts it in half", () => {
    assert.equal(accountName("😀".repeat(101)), "😀".repeat(100));
  });

  test("leaves no space at the cut", () => {
    assert.equal(accountName(`${"a".repeat(99)} b`), "a".repeat(99));
  });
});
