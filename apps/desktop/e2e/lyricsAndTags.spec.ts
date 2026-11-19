import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import type { WaveBridge } from "../src/shared/bridge.ts";

test("Settings › Lyrics and tags has the phone's switches, keeps them and runs Fix Songs", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-lyrics-tags-"));
  const launch = (language: string) =>
    electron.launch({
      args: [join(import.meta.dirname, ".."), `--lang=${language}`],
      env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
    });
  let app = await launch("en");
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Lyrics and tags", exact: true }).click();
    const body = page.getByTestId("lyrics-and-tags-settings");
    await expect(body).toBeVisible();
    await expect(page.getByText("available in a later update")).toHaveCount(0);

    const lookups = page.getByRole("switch", { name: "Fix songs online", exact: true });
    const photos = page.getByRole("switch", { name: "Download artist photos", exact: true });
    const fixLibrary = page.getByRole("button", { name: "Fix songs in the whole Library" });
    await expect(lookups).toBeChecked();
    await expect(photos).toBeChecked();
    await expect(page.getByRole("button", { name: "Clear artist photos" })).toBeDisabled();
    await expect(body).toContainText("keeps the photos on this computer");
    await page.screenshot({ path: test.info().outputPath("lyrics-and-tags-en.png") });

    // An empty Library has nothing to look up, so the run ends at once and says how it went.
    await fixLibrary.click();
    await expect(page.locator(".action-toast")).toBeVisible();
    await expect(fixLibrary).toBeVisible();

    await lookups.uncheck();
    await expect(fixLibrary).toBeDisabled();
    await photos.uncheck();
    const saved = () =>
      page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.lyricsAndTags.view());
    await expect.poll(saved).toMatchObject({ fixSongsOnline: false, downloadArtistPhotos: false });
    await page.screenshot({ path: test.info().outputPath("lyrics-and-tags-off-en.png") });
    await app.close();

    app = await launch("pt-BR");
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    await page.getByRole("button", { name: "Letras e tags", exact: true }).click();
    const online = page.getByRole("switch", { name: "Corrigir músicas online", exact: true });
    await expect(online).not.toBeChecked();
    await expect(
      page.getByRole("switch", { name: "Baixar fotos de artistas", exact: true }),
    ).not.toBeChecked();
    await online.check();
    await expect(
      page.getByRole("button", { name: "Corrigir músicas em toda a Biblioteca" }),
    ).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath("lyrics-and-tags-pt-BR.png") });
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
