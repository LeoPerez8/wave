import { defineConfig } from "@playwright/test";
import config from "./playwright.config.ts";

/** Performance runs alone, without retries or concurrent Electron instances. */
export default defineConfig({
  ...config,
  testIgnore: [],
  testMatch: "performance.spec.ts",
  outputDir: "perf-results/playwright",
  retries: 0,
});
