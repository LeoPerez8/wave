import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nextVersion } from "./next-version.ts";
import { localizedNotes } from "./localized-notes.ts";
import { artifactName, desktopPlatforms } from "../../apps/updates/src/desktopProtocol.ts";
import { verifyAuthenticodePayload } from "../../apps/desktop/scripts/authenticode-payload.ts";
import {
  admitDesktop,
  recordDesktopBuild,
  verifyDesktopFiles,
  finalizeWindowsDesktop,
  windowsSigningInput,
} from "../../apps/updates/src/desktopEvidence.ts";

test("Authenticode return may add a certificate table and alignment but must preserve the PE payload", () => {
  const unsigned = Buffer.alloc(513);
  unsigned.write("MZ");
  unsigned.writeUInt32LE(64, 60);
  unsigned.write("PE\0\0", 64);
  unsigned.writeUInt16LE(240, 84);
  unsigned.writeUInt16LE(0x20b, 88);
  unsigned.writeUInt32LE(16, 196);
  unsigned[512] = 1;
  const signed = Buffer.concat([unsigned, Buffer.alloc(23)]);
  signed.writeUInt32LE(1, 152);
  signed.writeUInt32LE(520, 232);
  signed.writeUInt32LE(16, 236);
  verifyAuthenticodePayload(unsigned, signed);
  const replaced = Buffer.from(signed);
  replaced[512] = 2;
  assert.throws(() => verifyAuthenticodePayload(unsigned, replaced), /payload/);
  assert.throws(() => verifyAuthenticodePayload(unsigned, unsigned), /certificate/);
  assert.throws(
    () => verifyAuthenticodePayload(unsigned, Buffer.concat([signed, Buffer.alloc(1)])),
    /certificate/,
  );
});

test("Windows signing starts from the admitted payload and publication requires final files", async () => {
  const root = await mkdtemp(join(tmpdir(), "wave-signpath-"));
  const source = "a".repeat(40);
  const key = "b".repeat(64);
  const tag = "v0.71.0-ti";
  const win = join(root, "desktop-release-win32");
  const linux = join(root, "desktop-release-linux");
  try {
    await mkdir(win);
    await mkdir(linux);
    await writeFile(join(win, windowsSigningInput), "unsigned app archive");
    await writeFile(join(linux, artifactName("linux", tag.slice(1))), "AppImage");
    await recordDesktopBuild(linux, "linux", source, tag, key);
    await recordDesktopBuild(win, "win32", source, tag, key, true);
    const admitted = await admitDesktop(root, source, tag, true);
    await assert.rejects(admitDesktop(root, source, tag));
    await assert.rejects(verifyDesktopFiles(root, admitted));
    await verifyDesktopFiles(root, admitted, false, true);
    await writeFile(join(win, windowsSigningInput), "swapped archive");
    await assert.rejects(verifyDesktopFiles(root, admitted, false, true), /release evidence/);
    const exe = join(win, artifactName("win32", tag.slice(1)));
    await writeFile(exe, "signed installer");
    await writeFile(exe + ".blockmap", "final blockmap");
    await recordDesktopBuild(win, "win32", source, tag, key);
    await assert.rejects(finalizeWindowsDesktop(root, admitted, "wrong digest"));
    const build = await readFile(join(win, "build.json"));
    const final = await finalizeWindowsDesktop(
      root,
      admitted,
      createHash("sha256").update(build).digest("hex"),
    );
    assert.deepEqual(final.files.linux, admitted.files.linux);
    await verifyDesktopFiles(root, final);
    await writeFile(exe, "swapped installer");
    await assert.rejects(verifyDesktopFiles(root, final), /release evidence/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
