import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configureAutostart } from "./autostart.ts";

test("Linux login launches the AppImage hidden, and disabling removes only Wave's entry", async () => {
  const config = await mkdtemp(join(tmpdir(), "wave-login-"));
  const options = {
    platform: "linux",
    config,
    executable: "/home/me/Music Apps/Wave.AppImage",
    args: [],
  };
  try {
    await configureAutostart(options, true);
    const entry = await readFile(join(config, "autostart/wave.desktop"), "utf8");
    assert.match(entry, /Exec="\/home\/me\/Music Apps\/Wave.AppImage" "--hidden"/);
    assert.match(entry, /Type=Application/);
    assert.match(entry, /Terminal=false/);
    await configureAutostart(options, false);
    await assert.rejects(stat(join(config, "autostart/wave.desktop")), { code: "ENOENT" });
    await configureAutostart(options, false);
  } finally {
    await rm(config, { recursive: true, force: true });
  }
});

test("Windows login uses the same executable with --hidden, including an unpackaged app's path", async () => {
  let registered: unknown;
  const options = {
    platform: "win32",
    config: "unused",
    executable: "C:\\Wave\\Wave.exe",
    args: ["C:\\wt\\1157\\apps\\desktop"],
    setLogin: (settings: unknown) => {
      registered = settings;
    },
  };
  await configureAutostart(options, true);
  assert.deepEqual(registered, {
    openAtLogin: true,
    path: "C:\\Wave\\Wave.exe",
    args: ["C:\\wt\\1157\\apps\\desktop", "--hidden"],
  });
  await configureAutostart(options, false);
  assert.equal((registered as { openAtLogin: boolean }).openAtLogin, false);
});
