import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * Core runs on the phone under Hermes, which lacks the ES2023 copying array
 * methods. Node has them, so the other tests would pass and the app would throw.
 */
const MISSING_IN_HERMES = /\.(?:toSorted|toReversed|toSpliced)\(/;

describe("Core on Hermes", () => {
  test("runtime code never calls an array method Hermes lacks", () => {
    const folder = new URL("./", import.meta.url);
    const offenders = readdirSync(folder)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .flatMap((name) =>
        readFileSync(new URL(name, folder), "utf8")
          .split("\n")
          .flatMap((line, index) =>
            MISSING_IN_HERMES.test(line) ? [`${name}:${index + 1}: ${line.trim()}`] : [],
          ),
      );
    assert.deepEqual(offenders, []);
  });
});
