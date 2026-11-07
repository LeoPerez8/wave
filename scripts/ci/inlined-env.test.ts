import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// Metro inlines every EXPO_PUBLIC_* variable into the JS bundle, which anyone can read out of
// the APK or an over-the-air update. So no workflow feeds one from a secret, and no app code
// reads one named like a key. Upstream keys live in the sync Worker (apps/sync/README.md).

const root = fileURLToPath(new URL("../../", import.meta.url));
const workflowsDir = join(root, ".github/workflows");

/** Every file under [dir] whose name passes [keep], skipping dependencies and build output. */
const filesUnder = (dir: string, keep: (name: string) => boolean): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["node_modules", "android", "ios", "build", "dist", ".expo"].includes(entry.name)
        ? []
        : filesUnder(path, keep);
    }
    return keep(entry.name) ? [path] : [];
  });

/** The lines of [files] that match [pattern], as `file:line: text`. */
const matching = (files: readonly string[], pattern: RegExp): string[] =>
  files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        pattern.test(line) ? [`${relative(root, file)}:${index + 1}: ${line.trim()}`] : [],
      ),
  );

/** An EXPO_PUBLIC_ name that reads as a credential. */
const credentialName = /EXPO_PUBLIC_\w*(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/;

describe("inlined env", () => {
  const workflows = filesUnder(workflowsDir, (name) => /\.ya?ml$/.test(name));

  it("finds the workflows", () => {
    assert.ok(workflows.some((file) => file.endsWith("ci.yml")));
  });

  it("is never fed from a secret by a workflow", () => {
    assert.deepEqual(matching(workflows, /EXPO_PUBLIC_\w*.*\bsecrets\./), []);
  });

  it("names no credential in a workflow or a build script", () => {
    const scripts = filesUnder(join(root, "scripts"), (name) => /\.(sh|ts|mjs|gradle)$/.test(name));
    const tests = (file: string) => /\.test\.\w+$/.test(file);
    assert.deepEqual(
      matching([...workflows, ...scripts.filter((f) => !tests(f))], credentialName),
      [],
    );
  });

  it("names no credential in the app, Core or the app's config", () => {
    const code = (name: string) =>
      /\.(ts|tsx|js|mjs|cjs|json)$/.test(name) || name.startsWith(".env");
    const files = [
      ...filesUnder(join(root, "apps/mobile"), code),
      ...filesUnder(join(root, "packages/core"), code),
    ];
    assert.deepEqual(matching(files, credentialName), []);
  });
});
