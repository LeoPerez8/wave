import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkClientImports } from "./client-imports.ts";
import { fileURLToPath } from "node:url";

test("the shared client obeys the platform boundary", () => {
  assert.deepEqual(
    checkClientImports(fileURLToPath(new URL("../../packages/client", import.meta.url))),
    [],
  );
});

test("client guard rejects platform imports in every import form, including driver subpaths", () => {
  const root = mkdtempSync(join(tmpdir(), "wave-client-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: {
          "@wave/core": "workspace:*",
          effect: "4.0.2",
          "drizzle-orm": "0.45.4",
        },
      }),
    );
    for (const source of [
      'import "expo-sqlite";',
      'import type { View } from "react-native";',
      'export { app } from "electron/main";',
      'const react = require("react");',
      'const react = import("react/jsx-runtime");',
      'type Expo = import("@expo/config").ExpoConfig;',
      'import { drizzle } from "drizzle-orm/expo-sqlite";',
      'import { db } from "../../apps/mobile/store.ts";',
    ]) {
      writeFileSync(join(root, "src", "query.ts"), source);
      assert.ok(checkClientImports(root).length > 0, source);
    }
    writeFileSync(
      join(root, "src", "query.ts"),
      'import { sql } from "drizzle-orm"; import type { Song } from "@wave/core";',
    );
    assert.deepEqual(checkClientImports(root), []);
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { react: "19" } }));
    assert.ok(checkClientImports(root).some((error) => error.includes("react")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
