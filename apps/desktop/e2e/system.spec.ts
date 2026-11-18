import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
const electronPath = createRequire(import.meta.url)("electron") as string;
const mainWindow = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle() === "Wave")
      ?.isVisible(),
  );

test("close keeps playing, the tray notice appears once, relaunch shows Wave, and close-to-quit persists", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-system-"));
  // A minute of silence keeps this an OS-control check without making the machine play a tone.
  const wav = Buffer.alloc(44 + 44_100 * 4 * 60);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44_100, 24);
  wav.writeUInt32LE(176_400, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  // Chromium drops media artwork under 71 px, so the 32 px tag fixture won't do.
  const cover = join(appFolder, "../mobile/assets/icon.png");
  const hash = createHash("sha1").update(readFileSync(cover)).digest("hex");
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (let n = 1; n <= 2; n++) {
        const song = join(data, `silence-${n}.wav`);
        writeFileSync(song, wav);
        const id = addTrack(db, {
          title: `Tray Song ${n}`,
          artist: "Wave Test",
          album: "System controls",
          durationMs: 60_000,
          artworkHash: hash,
        });
        db.run(sql`UPDATE tracks SET path=${song} WHERE id=${id}`);
      }
      db.run(sql`UPDATE artwork SET path=${cover}, thumb_path=${cover} WHERE hash=${hash}`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const env = { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") };
  const launch = (hidden = false) =>
    electron.launch({ args: [appFolder, "--lang=en-US", ...(hidden ? ["--hidden"] : [])], env });
  let app = await launch();
  const errors: string[] = [];
  app.process().stderr?.on("data", (chunk: Buffer) => errors.push(chunk.toString()));
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    await page.getByRole("row", { name: /Tray Song 1/ }).dblclick();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { wave: WaveBridge }).wave.playback
            .view()
            .then((v) => v.status.state),
        ),
      )
      .toBe("playing");
    // Observe the native notice without leaving a modal dialog in unattended CI.
    await app.evaluate(({ dialog }) => {
      const state = globalThis as unknown as { notices: string[] };
      state.notices = [];
      dialog.showMessageBox = async (options: unknown) => {
        state.notices.push(JSON.stringify(options));
        return { response: 0, checkboxChecked: false };
      };
    });
    const close = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === "Wave")!
          .close(),
      );
    await close();
    expect(await mainWindow(app)).toBe(false);
    expect(
      await page.evaluate(() =>
        (window as unknown as { wave: WaveBridge }).wave.playback
          .view()
          .then((v) => v.status.state),
      ),
    ).toBe("playing");
    expect(
      await app.evaluate(() => (globalThis as unknown as { notices: string[] }).notices.length),
    ).toBe(1);
    // A second real process must reveal the first one, not create another player.
    const second = spawn(electronPath, [appFolder, "--lang=en-US"], {
      env,
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise<void>((resolve) => second.once("exit", () => resolve()));
    await expect.poll(() => mainWindow(app)).toBe(true);
    await close();
    expect(
      await app.evaluate(() => (globalThis as unknown as { notices: string[] }).notices.length),
    ).toBe(1);

    // Optional native OS probes; these operate the real session, not the renderer bridge.
    const probe = process.env["WAVE_SMTC_PROBE"];
    if (process.platform === "win32" && probe) {
      const control = (action: string, title = "Tray Song 1") =>
        execFileSync(probe, [title, action], { encoding: "utf8" });
      await expect
        .poll(() => control("metadata"))
        .toContain("Wave Test|System controls|60000|cover=true");
      control("pause");
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as { wave: WaveBridge }).wave.playback
              .view()
              .then((v) => v.status.state),
          ),
        )
        .toBe("paused");
      control("play");
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as { wave: WaveBridge }).wave.playback
              .view()
              .then((v) => v.status.state),
          ),
        )
        .toBe("playing");
      control("seek");
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as { wave: WaveBridge }).wave.playback
              .view()
              .then((v) => Math.round(v.status.positionMs)),
          ),
        )
        .toBeGreaterThanOrEqual(5000);
      control("next");
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as { wave: WaveBridge }).wave.playback
              .view()
              .then((v) => v.current?.title),
          ),
        )
        .toBe("Tray Song 2");
      control("previous", "Tray Song 2");
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as { wave: WaveBridge }).wave.playback
              .view()
              .then((v) => v.current?.title),
          ),
        )
        .toBe("Tray Song 1");
    }
    if (process.platform === "linux" && process.env["WAVE_PLAYERCTL"] === "1") {
      const control = (...args: string[]) =>
        execFileSync("playerctl", ["--player=wave", ...args], { encoding: "utf8" });
      // playerctl fails until the first metadata is published.
      const playing = () => {
        try {
          return control("metadata", "xesam:title").trim();
        } catch {
          return "";
        }
      };
      await expect.poll(playing).toBe("Tray Song 1");
      expect(control("metadata", "xesam:artist")).toContain("Wave Test");
      expect(control("metadata", "mpris:artUrl")).toContain("file://");
      control("pause");
      await expect.poll(() => control("status").trim()).toBe("Paused");
      control("position", "5");
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as { wave: WaveBridge }).wave.playback
              .view()
              .then((v) => v.status.positionMs),
          ),
        )
        .toBeGreaterThanOrEqual(5000);
      control("play");
      control("next");
      await expect.poll(playing).toBe("Tray Song 2");
      control("previous");
      await expect.poll(playing).toBe("Tray Song 1");
      execFileSync("dbus-send", [
        "--session",
        "--dest=org.mpris.MediaPlayer2.wave",
        "--type=method_call",
        "/org/mpris/MediaPlayer2",
        "org.mpris.MediaPlayer2.Raise",
      ]);
      await expect.poll(() => mainWindow(app)).toBe(true);
    }
    // Login's launch flag stays hidden and restores the queue paused.
    await app.close();
    app = await launch(true);
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { wave: WaveBridge }).wave.playback
            .view()
            .then((v) => v.current?.title),
        ),
      )
      .toBe("Tray Song 1");
    expect(await mainWindow(app)).toBe(false);
    expect(
      await page.evaluate(() =>
        (window as unknown as { wave: WaveBridge }).wave.playback
          .view()
          .then((v) => v.status.state),
      ),
    ).not.toBe("playing");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "Wave")!
        .show(),
    );
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Window", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Start with the system", exact: true }),
    ).not.toBeChecked();
    await page
      .getByRole("checkbox", { name: "Closing the window quits Wave", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { wave: WaveBridge }).wave.settings
            .window()
            .then((v) => v.closeQuits),
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: join(appFolder, "test-results", `window-settings-${process.platform}.png`),
    });
    const exited = app.waitForEvent("close");
    await close();
    await exited;
    // A machine with no session bus (CI's plain run) has no MPRIS to offer.
    if (process.platform !== "linux" || process.env["WAVE_PLAYERCTL"] === "1")
      expect(errors.join("")).not.toContain("[system] Media controls unavailable");
    expect(errors.join("")).not.toContain("[system] Media command failed");
  } finally {
    // Closing an app that already quit throws.
    await app.close().catch(() => undefined);
    rmSync(data, { recursive: true, force: true });
  }
});
