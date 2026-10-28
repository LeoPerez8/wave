import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * The app runs on the phone under Hermes, which lacks the ES2023 copying
 * array methods. Node has them, so the store tests would pass and the phone
 * would throw (#734). Core has the same guard.
 */
const MISSING_IN_HERMES = /\.(?:toSorted|toReversed|toSpliced)\(/;

describe("The app on Hermes", () => {
  test("runtime code never calls an array method Hermes lacks", () => {
    const folder = new URL("./", import.meta.url);
    const offenders = readdirSync(folder, { recursive: true, encoding: "utf8" })
      .map((name) => name.replaceAll("\\", "/"))
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
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
