import { test } from "node:test";
import { runTextGuard } from "../../../scripts/ci/untranslated-text-report.ts";

test("Core visible text comes from the catalogue", () => {
  runTextGuard("packages/core/src");
});
