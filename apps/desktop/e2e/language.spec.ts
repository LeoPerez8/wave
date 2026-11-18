import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

test("language applies live to Settings, missing album names, tray and native dialogs, then persists", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-language-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      addTrack((yield* Database) as unknown as TestDatabase, {
        title: "Untagged Album",
        artist: "Wave Test",
        album: "Unknown Album",
      });
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const launch = () =>
    electron.launch({
      args: [join(import.meta.dirname, ".."), "--lang=pt-BR"],
      env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    await page.getByRole("button", { name: "Aparência", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Idioma", exact: true })).toHaveValue("system");
    await page.getByRole("combobox", { name: "Idioma", exact: true }).selectOption("en");
    await expect(page.getByRole("combobox", { name: "Language", exact: true })).toHaveValue("en");
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("pt-BR");
    await expect(page.getByRole("combobox", { name: "Idioma", exact: true })).toHaveValue("pt-BR");
    await page.screenshot({ path: test.info().outputPath("language-settings-pt-BR.png") });
    await page.getByRole("button", { name: "Músicas", exact: true }).click();
    await expect(page.getByRole("row", { name: /Untagged Album/ })).toContainText(
      "Álbum Desconhecido",
    );
    await page.screenshot({ path: test.info().outputPath("language-songs-pt-BR.png") });
    await page.getByRole("button", { name: "Álbuns", exact: true }).click();
    await expect(page.getByRole("grid").getByText("Álbum Desconhecido")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("language-albums-pt-BR.png") });
    await page.getByRole("button", { name: "Músicas", exact: true }).click();
    // Capture the real Electron menu/dialog boundaries without leaving a modal open in CI.
    await app.evaluate(({ Menu, dialog }) => {
      const state = globalThis as unknown as { menuLabels: string[]; dialogs: unknown[] };
      state.menuLabels = [];
      state.dialogs = [];
      const build = Menu.buildFromTemplate;
      Menu.buildFromTemplate = (template) => {
        state.menuLabels = template.map((item) => item.label ?? "");
        return build(template);
      };
      dialog.showMessageBox = async (options) => {
        state.dialogs.push(options);
        return { response: 0, checkboxChecked: false };
      };
      dialog.showOpenDialog = async (options) => {
        state.dialogs.push(options);
        return { canceled: true, filePaths: [] };
      };
    });
    await page.evaluate(async () => {
      const wave = (window as unknown as { wave: WaveBridge }).wave;
      await wave.settings.setLanguage("en");
    });
    await expect(page.getByRole("button", { name: "Songs", exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /Untagged Album/ })).toContainText("Unknown Album");
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as unknown as { menuLabels: string[] }).menuLabels),
      )
      .toContain("Quit");
    await page.evaluate(async () => {
      const wave = (window as unknown as { wave: WaveBridge }).wave;
      await wave.settings.setLanguage("pt-BR");
      await wave.library.addRoot();
    });
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as unknown as { menuLabels: string[] }).menuLabels),
      )
      .toContain("Sair");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    const dialogs = await app.evaluate(
      () => (globalThis as unknown as { dialogs: unknown[] }).dialogs,
    );
    expect(JSON.stringify(dialogs)).toContain("A música continua tocando");
    expect(JSON.stringify(dialogs)).toContain("pasta");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    await page.getByRole("button", { name: "Aparência", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Idioma", exact: true })).toHaveValue("pt-BR");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
