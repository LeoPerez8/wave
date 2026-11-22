/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { reactCompilerOn } from "./reactCompiler.ts";

describe("reactCompilerOn", () => {
  test("is on when the build doesn't say", () => {
    assert.equal(reactCompilerOn(undefined), true);
    assert.equal(reactCompilerOn(""), true);
  });

  test("is on when the build asks for it", () => {
    assert.equal(reactCompilerOn("1"), true);
  });

  test("is off only when the build turns it off", () => {
    assert.equal(reactCompilerOn("0"), false);
  });
});
