import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// The sync Worker's database, Soulseek, upstream and analytics credentials are Worker secrets
// set by hand (apps/sync/README.md, Configuration). CI, the update Worker, the app (its JS,
// native code and config) and Core never need one, so none of them may even name one: a
// workflow that names it could be handed it, and app code that names it could inline it.

const root = fileURLToPath(new URL("../../", import.meta.url));

/** The sync Worker's private settings, as apps/sync/README.md lists them. */
const syncCredential =
  /\b(TURSO_AUTH_TOKEN|TURSO_DATABASE_URL|SOULSEEK_KEY\w*|GENIUS_ACCESS_TOKEN|TICKETMASTER_API_KEY|CLOUDFLARE_ANALYTICS_TOKEN|ALLOWED_EMAILS)\b/;

const skipped = new Set(["node_modules", "build", "dist", ".expo", ".gradle", ".cxx", ".wrangler"]);
const text = /\.(ya?ml|sh|ts|tsx|js|mjs|cjs|json|gradle|kts|kt|java|properties|xml|toml)$/;

/** Every source file under [dir], skipping dependencies and build output. */
const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return skipped.has(entry.name) ? [] : sourcesUnder(path);
    return text.test(entry.name) || entry.name.startsWith(".env") ? [path] : [];
  });

/** The lines of [files] that name a sync credential, as `file:line: text`. */
const naming = (files: readonly string[]): string[] =>
  files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        syncCredential.test(line) ? [`${relative(root, file)}:${index + 1}: ${line.trim()}`] : [],
      ),
  );

const isTest = (file: string) => /\.test\.\w+$/.test(file);

describe("sync credentials", () => {
  it("are named by no workflow and no CI script", () => {
    const files = [
      ...sourcesUnder(join(root, ".github")),
      ...sourcesUnder(join(root, "scripts")).filter((file) => !isTest(file)),
    ];
    assert.ok(files.some((file) => file.endsWith("ci.yml")));
    assert.deepEqual(naming(files), []);
  });

  it("are named nowhere in the app, its native modules, Core or the update Worker", () => {
    const files = [
      ...sourcesUnder(join(root, "apps/mobile")),
      ...sourcesUnder(join(root, "packages")),
      ...sourcesUnder(join(root, "apps/updates")),
    ].filter((file) => !isTest(file));
    assert.ok(files.some((file) => file.endsWith(".kt")));
    assert.deepEqual(naming(files), []);
  });
});
