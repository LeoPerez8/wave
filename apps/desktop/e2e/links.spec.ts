import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, test, expect } from "@playwright/test";
import type { WaveBridge } from "../src/shared/bridge.ts";
import { catalogueOf } from "@wave/core";

test("paste and drop open supported links, ignore ordinary text and preserve text-field paste", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-links-"));
  const app = await electron.launch({
    args: [join(import.meta.dirname, ".."), "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const text = catalogueOf("en", "desktop");
    // Copy Link writes the system clipboard, from main.
    await page.evaluate(async () => {
      const wave = (window as unknown as { wave: WaveBridge }).wave;
      await wave.settings.setYtMusic(true);
      await wave.links.copySong("abcdefghijk", "en");
      // Off from here on, so the links below ask no service anything.
      await wave.settings.setYtMusic(false);
    });
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      "https://song.link/y/abcdefghijk",
    );
    const paste = (value: string) =>
      page.evaluate((value) => {
        const data = new DataTransfer();
        data.setData("text/plain", value);
        (document.activeElement ?? document).dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, value);
    await paste("Pink Moon");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    for (const link of [
      "https://music.youtube.com/watch?v=abcdefghijk",
      "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
      "https://music.youtube.com/playlist?list=PLabcdefghijk",
      "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
      "https://spotify.link/abc",
    ]) {
      await paste(link);
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.getByRole("alertdialog").getByRole("button").first().click();
      await page.evaluate((link) => {
        const data = new DataTransfer();
        data.setData("text/uri-list", `# shared link\r\n${link}`);
        document.dispatchEvent(
          new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }),
        );
      }, link);
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.getByRole("alertdialog").getByRole("button").first().click();
    }
    await page.getByRole("searchbox", { name: text.desktopLayout.search }).focus();
    await paste("https://music.youtube.com/watch?v=abcdefghijk");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
