import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
const shots = process.env["WAVE_SHOTS_DIR"] ?? join(appFolder, "test-results");

/** What main knows of the window titled [title]. */
const windowState = (app: ElectronApplication, title: string) =>
  app.evaluate(({ BrowserWindow }, wanted) => {
    const found = BrowserWindow.getAllWindows().find((w) => w.getTitle() === wanted);
    if (found === undefined) return null;
    // What the page really runs with; Electron has the call but doesn't type it.
    const { sandbox, contextIsolation, nodeIntegration, webviewTag } =
      (
        found.webContents as unknown as {
          getLastWebPreferences: () => Electron.WebPreferences | null;
        }
      ).getLastWebPreferences() ?? {};
    return {
      visible: found.isVisible(),
      onTop: found.isAlwaysOnTop(),
      position: found.getPosition(),
      bounds: found.getBounds(),
      preferences: { sandbox, contextIsolation, nodeIntegration, webviewTag },
    };
  }, title);

const playerState = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { wave: WaveBridge }).wave.playback.view().then((v) => v.status.state),
  );

const policy = (page: Page) =>
  page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");

/** A minute of silence, so the check plays without a sound. */
const silence = () => {
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
  return wav;
};

test("the mini player opens from the player bar and the tray, controls playback above other windows, and comes back where it was left", async () => {
  // Three launches: the window, a restart, and a start after its monitor is gone.
  test.setTimeout(180_000);
  const data = mkdtempSync(join(tmpdir(), "wave-mini-"));
  const database = libraryLayer(join(data, "wave.db"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (let n = 1; n <= 2; n++) {
        const song = join(data, `silence-${n}.wav`);
        writeFileSync(song, silence());
        const id = addTrack(db, {
          title: `Mini Song ${n}`,
          artist: "Wave Test",
          album: "Mini player",
          durationMs: 60_000,
        });
        db.run(sql`UPDATE tracks SET path=${song} WHERE id=${id}`);
      }
    }).pipe(Effect.provide(database)),
  );
  const env = { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") };
  const launch = () => electron.launch({ args: [appFolder, "--lang=en-US"], env });
  let app = await launch();
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    await page.getByRole("row", { name: /Mini Song 1/ }).dblclick();
    await expect.poll(() => playerState(page)).toBe("playing");

    // From the player bar.
    const opened = app.waitForEvent("window");
    await page.getByRole("button", { name: "Mini Player", exact: true }).click();
    const mini = await opened;
    await expect(mini.getByText("Mini Song 1", { exact: true })).toBeVisible();
    await expect(mini.getByText("Wave Test", { exact: true })).toBeVisible();
    const main = await windowState(app, "Wave");
    const floating = await windowState(app, "Mini Player");
    expect(floating?.visible).toBe(true);
    expect(floating?.onTop).toBe(true);
    // The same sandbox, context isolation and CSP as the main window.
    expect(floating?.preferences).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    });
    expect(floating?.preferences).toEqual(main?.preferences);
    expect(await policy(mini)).toBe(await policy(page));
    expect(await policy(mini)).toContain("default-src 'none'");
    expect(await mini.evaluate(() => "require" in globalThis || "process" in globalThis)).toBe(
      false,
    );
    await mini.screenshot({ path: join(shots, `mini-player-${process.platform}.png`) });

    // Its buttons skip, pause, play and star, and both windows follow.
    const view = () =>
      page.evaluate(() =>
        (window as unknown as { wave: WaveBridge }).wave.playback
          .view()
          .then((v) => ({
            title: v.current?.title,
            state: v.status.state,
            at: v.status.positionMs,
          })),
      );
    const t0 = Date.now();
    console.log("DIAG before-next", JSON.stringify(await view()));
    await mini.getByRole("button", { name: "Next", exact: true }).click();
    const t1 = Date.now();
    await expect(mini.getByText("Mini Song 2", { exact: true })).toBeVisible();
    await expect(page.locator(".player-bar .player-title").first()).toHaveText("Mini Song 2");
    const t2 = Date.now();
    const pre = await view();
    await mini.getByRole("button", { name: "Previous", exact: true }).click();
    const t3 = Date.now();
    console.log(
      "DIAG timing",
      JSON.stringify({ nextClick: t1 - t0, checks: t2 - t1, previousClick: t3 - t2, pre }),
    );
    try {
      await expect(mini.getByText("Mini Song 1", { exact: true })).toBeVisible();
    } catch (e) {
      console.log(
        "DIAG FAIL",
        JSON.stringify({ after: await view(), mini: await mini.locator("body").innerText() }),
      );
      throw e;
    }
    await mini.getByRole("button", { name: "Pause", exact: true }).click();
    await expect.poll(() => playerState(page)).toBe("paused");
    await mini.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(() => playerState(page)).toBe("playing");
    const star = mini.getByRole("button", { name: "Favorite", exact: true });
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    // The thin line follows the song.
    await expect
      .poll(() =>
        mini
          .locator(".mini-progress")
          .evaluate((line) => parseFloat(line.style.getPropertyValue("--progress"))),
      )
      .toBeGreaterThan(0);

    // Space plays and pauses from the mini player.
    await mini.locator(".mini-song").click();
    await mini.keyboard.press("Space");
    await expect.poll(() => playerState(page)).toBe("paused");
    await expect(mini.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await mini.keyboard.press("Space");
    await expect.poll(() => playerState(page)).toBe("playing");

    // The main window hides while the mini player stays, and its button brings it back.
    await app.evaluate(({ BrowserWindow, dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "Wave")!
        .close();
    });
    expect((await windowState(app, "Wave"))?.visible).toBe(false);
    expect((await windowState(app, "Mini Player"))?.visible).toBe(true);
    await mini.getByRole("button", { name: "Next", exact: true }).click();
    await expect(mini.getByText("Mini Song 2", { exact: true })).toBeVisible();
    await mini.getByRole("button", { name: "Show Wave", exact: true }).click();
    await expect.poll(async () => (await windowState(app, "Wave"))?.visible).toBe(true);
    expect((await windowState(app, "Mini Player"))?.visible).toBe(true);

    // Dragged somewhere, then closed: Wave keeps running and playing.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "Mini Player")!
        .setPosition(180, 140),
    );
    const closed = mini.waitForEvent("close");
    await mini.getByRole("button", { name: "Close Mini Player", exact: true }).click();
    await closed;
    expect(await windowState(app, "Mini Player")).toBeNull();
    expect((await windowState(app, "Wave"))?.visible).toBe(true);
    expect(await playerState(page)).toBe("playing");

    // From the tray menu: its entry is read off the menu Wave builds, and clicked.
    await app.evaluate(({ Menu }) => {
      const state = globalThis as unknown as { trayMenu: Electron.MenuItemConstructorOptions[] };
      const build = Menu.buildFromTemplate.bind(Menu);
      Menu.buildFromTemplate = (template) => {
        state.trayMenu = template as Electron.MenuItemConstructorOptions[];
        return build(template);
      };
    });
    // A change of state makes Wave build the menu again.
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(() =>
          (
            globalThis as unknown as { trayMenu?: Electron.MenuItemConstructorOptions[] }
          ).trayMenu?.map((item) => item.label ?? ""),
        ),
      )
      .toContain("Mini Player");
    const again = app.waitForEvent("window");
    await app.evaluate(() => {
      const entry = (
        globalThis as unknown as { trayMenu: Electron.MenuItemConstructorOptions[] }
      ).trayMenu.find((item) => item.label === "Mini Player")!;
      (entry.click as () => void)();
    });
    const reopened = await again;
    await expect(reopened.getByText("Mini Song 2", { exact: true })).toBeVisible();
    // Where it was left.
    expect((await windowState(app, "Mini Player"))?.position).toEqual([180, 140]);
  } finally {
    await app.close();
  }

  try {
    // After a restart it is where it was left.
    app = await launch();
    let page = await app.firstWindow();
    let opened = app.waitForEvent("window");
    await page.getByRole("button", { name: "Mini Player", exact: true }).click();
    await opened;
    expect((await windowState(app, "Mini Player"))?.position).toEqual([180, 140]);
    await app.close();

    // Left on a monitor that is gone, it comes back onto a screen.
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = (yield* Database) as unknown as TestDatabase;
        db.run(
          sql`UPDATE desktop_settings SET value=${JSON.stringify({ x: -9000, y: -7000 })} WHERE key='miniPlayer.position'`,
        );
      }).pipe(Effect.provide(database)),
    );
    app = await launch();
    page = await app.firstWindow();
    opened = app.waitForEvent("window");
    await page.getByRole("button", { name: "Mini Player", exact: true }).click();
    await opened;
    const bounds = (await windowState(app, "Mini Player"))!.bounds;
    const onScreen = await app.evaluate(
      ({ screen }, { x, y, width, height }) =>
        screen.getAllDisplays().some(({ workArea: area }) => {
          const inside =
            x >= area.x &&
            y >= area.y &&
            x + width <= area.x + area.width &&
            y + height <= area.y + area.height;
          return inside;
        }),
      bounds,
    );
    expect(onScreen).toBe(true);
  } finally {
    await app.close().catch(() => undefined);
    rmSync(data, { recursive: true, force: true });
  }
});
