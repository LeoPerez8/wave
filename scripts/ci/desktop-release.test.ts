import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nextVersion } from "./next-version.ts";
import { localizedNotes } from "./localized-notes.ts";
import { artifactName, desktopPlatforms } from "../../apps/updates/src/desktopProtocol.ts";
import {
  admitDesktop,
  recordDesktopBuild,
  verifyDesktopFiles,
} from "../../apps/updates/src/desktopEvidence.ts";

test("release admission binds both desktop packages and the Windows blockmap to the exact source", async () => {
  const root = await mkdtemp(join(tmpdir(), "wave-desktop-evidence-"));
  const source = "a".repeat(40);
  const key = "b".repeat(64);
  const tag = "v0.71.0-ti";
  try {
    for (const platform of desktopPlatforms) {
      const dir = join(root, `desktop-release-${platform}`);
      await mkdir(dir);
      const name = artifactName(platform, tag.slice(1));
      await writeFile(join(dir, name), "installer");
      if (platform === "win32") await writeFile(join(dir, `${name}.blockmap`), "blockmap");
      await recordDesktopBuild(dir, platform, source, tag, key);
    }
    const proof = await admitDesktop(root, source, tag);
    await verifyDesktopFiles(root, proof);
    await assert.rejects(admitDesktop(root, "c".repeat(40), tag), /source/);
    await writeFile(
      join(root, "desktop-release-win32", "wave-0.71.0-ti-win-x64.exe.blockmap"),
      "tampered",
    );
    await assert.rejects(verifyDesktopFiles(root, proof), /blockmap/);
    await assert.rejects(admitDesktop(root, source, tag), /blockmap/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop-only changes can release and appear in desktop notes without appearing in Android notes", () => {
  const files = ["apps/desktop/src/renderer/src/App.tsx"];
  assert.equal(
    nextVersion({ version: "0.71.0-ti", channel: "ti", tags: ["v0.71.0-ti"], changed: files })
      .version,
    "0.71.1-ti",
  );
  const desktop = {
    number: 1164,
    title: "Install signed desktop updates",
    body: "pt-BR: Instale atualizações assinadas",
    branch: "feat/1164-desktop",
    base: "main",
    mergeCommit: "desktop-merge",
    issues: [],
    url: "https://github.com/LeoPerez8/wave/pull/1164",
    files,
  };
  const input = { commits: ["desktop-merge"], bugIssues: [], pullRequests: [desktop] };
  assert.deepEqual(localizedNotes(input).en.new, []);
  assert.deepEqual(localizedNotes(input, "desktop")["pt-BR"].new, [
    "Instale atualizações assinadas",
  ]);
});
