import { test } from "node:test";
import { runTextGuard } from "../../../scripts/ci/untranslated-text-report.ts";

test("app UI text comes from the catalogue (report until Portuguese launches)", () => {
  runTextGuard("apps/mobile/src");
});
