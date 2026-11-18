import { defineConfig } from "@playwright/test";

/** Drives the built app (`pnpm build` first; `pnpm test:e2e` does both). */
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  timeout: 60_000,
  workers: 1,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["html", { open: "never" }]],
});
