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

/** Each song's sidecar lyrics: two in Portuguese, one already in English. */
const SONGS = {
  Agua: "[00:00.00]Espere pela água\n[00:10.00]\n[00:20.00]Então vá\n",
  Rain: "[00:00.00]Wait for the rain\n[00:20.00]Then go\n",
  Chuva: "[00:00.00]Chuva forte\n",
};

const writeSong = (path: string) => {
  // 30 seconds of mono 16-bit PCM so the test can seek away from the first line.
  const rate = 8_000;
  const wave = Buffer.alloc(44 + 30 * rate * 2);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(rate, 24);
  wave.writeUInt32LE(rate * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(wave.length - 44, 40);
  writeFileSync(path, wave);
};

/**
 * Stands in for Google Translate in main: answers each text from a small dictionary, found in
 * Portuguese, or gives it back as English. `WAVE_E2E_TRANSLATE` makes it fail or wait.
 */
const fakeGoogle = (app: ElectronApplication) =>
  app.evaluate(() => {
    const words: Record<string, string> = {
      "Espere pela água": "Wait for the water",
      "Então vá": "Then go",
      "Chuva forte": "Heavy rain",
    };
    const state = globalThis as unknown as { translatePosts: string[][] };
    state.translatePosts = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://clients5.google.com/translate_a/t")) {
        if (/translate/.test(url)) throw new Error(`unexpected translation request: ${url}`);
        return realFetch(input, init);
      }
      const texts = new URLSearchParams(String(init?.body)).getAll("q");
      state.translatePosts.push(texts);
      while (process.env["WAVE_E2E_TRANSLATE"] === "hold")
        await new Promise((resolve) => setTimeout(resolve, 50));
      if (process.env["WAVE_E2E_TRANSLATE"] === "fail") throw new Error("offline");
      return Response.json(
        texts.map((text) => (text in words ? [words[text], "pt"] : [text, "en"])),
      );
    };
  });

const mode = (app: ElectronApplication, value: "ok" | "hold" | "fail") =>
  app.evaluate((_, value) => {
    process.env["WAVE_E2E_TRANSLATE"] = value;
  }, value);

const posts = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { translatePosts: string[][] }).translatePosts);

const play = async (page: Page, title: string) => {
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("row", { name: new RegExp(title) }).dblclick();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  await page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.playback.pause());
};

test("Translate shows each line's translation, its states, and keeps both across a restart", async () => {
  // The first lyrics wait for the JVM to start, which is slow on a busy machine.
  test.setTimeout(240_000);
  const data = mkdtempSync(join(tmpdir(), "wave-translate-"));
  const launch = () =>
    electron.launch({
      args: [appFolder, "--lang=en-US"],
      env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
    });
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = (yield* Database) as unknown as TestDatabase;
        for (const [title, lyrics] of Object.entries(SONGS)) {
          const path = join(data, `${title}.wav`);
          writeSong(path);
          writeFileSync(join(data, `${title}.lrc`), lyrics);
          const id = addTrack(db, { title, artist: "Ana", durationMs: 30_000 });
          db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
        }
      }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
    );
    const app = await launch();
    try {
      await fakeGoogle(app);
      const page = await app.firstWindow();
      await play(page, "Agua");
      await page.getByRole("button", { name: "Lyrics", exact: true }).click();
      const panel = page.getByRole("tabpanel");
      const first = panel.getByRole("option", { name: "Espere pela água" });
      const last = panel.getByRole("option", { name: "Então vá" });
      await expect(first).toBeVisible({ timeout: 90_000 });

      // Off by default: the lyrics show as they are and Google is asked nothing.
      const translate = panel.getByRole("button", { name: "Translate Lyrics", exact: true });
      await expect(translate).toHaveAttribute("aria-pressed", "false");
      expect(await posts(app)).toEqual([]);

      // On: a skeleton under each line with words while Google is asked, then the translations.
      await mode(app, "hold");
      await translate.click();
      await expect(translate).toHaveAttribute("aria-pressed", "true");
      await expect(panel.locator(".lyric-translation-skeleton")).toHaveCount(2);
      await mode(app, "ok");
      await expect(first.locator(".lyric-translation")).toHaveText("Wait for the water");
      await expect(last.locator(".lyric-translation")).toHaveText("Then go");
      await expect(panel.locator(".lyric-translation")).toHaveCount(2);
      await expect(panel.locator(".lyric-translation-skeleton")).toHaveCount(0);
      expect(await posts(app)).toEqual([["Espere pela água", "Então vá"]]);

      // The translation sits in its line, so it lights with the sung one.
      await expect(first).toHaveAttribute("aria-current", "true");
      await expect(first).toHaveCSS("opacity", "1");
      await expect(last).not.toHaveCSS("opacity", "1");
      await last.click();
      await expect(last).toHaveAttribute("aria-current", "true");
      await expect(last).toHaveCSS("opacity", "1");
      await page.screenshot({ path: test.info().outputPath("translate-panel.png") });

      // Now Playing has the same switch and shows the saved translation with no request.
      await page.getByTitle("Opens Now Playing").click();
      const nowPlaying = page.getByRole("dialog", { name: "Now Playing", exact: true });
      const translateThere = nowPlaying.getByRole("button", {
        name: "Translate Lyrics",
        exact: true,
      });
      await expect(translateThere).toHaveAttribute("aria-pressed", "true");
      await expect(nowPlaying.locator(".lyric-translation")).toHaveText([
        "Wait for the water",
        "Then go",
      ]);
      await page.screenshot({ path: test.info().outputPath("translate-now-playing.png") });
      expect(await posts(app)).toHaveLength(1);
      await translateThere.click();
      await expect(nowPlaying.locator(".lyric-translation")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(nowPlaying).toBeHidden();
      await expect(translate).toHaveAttribute("aria-pressed", "false");
      await expect(panel.locator(".lyric-translation")).toHaveCount(0);

      // Off: another song's lyrics go nowhere.
      await play(page, "Rain");
      await expect(panel.getByRole("option", { name: "Wait for the rain" })).toBeVisible();
      expect(await posts(app)).toHaveLength(1);

      // Lyrics already in the app's language say so, with nothing under them.
      await translate.click();
      await expect(panel.getByText("These lyrics are already in English.")).toBeVisible();
      await expect(panel.locator(".lyric-translation")).toHaveCount(0);
      expect(await posts(app)).toHaveLength(2);

      // A failed request keeps the original and offers Try Again.
      await mode(app, "fail");
      await play(page, "Chuva");
      await expect(panel.getByText("Couldn't translate the lyrics.")).toBeVisible();
      const heavy = panel.getByRole("option", { name: "Chuva forte" });
      await expect(heavy).toBeVisible();
      await expect(panel.locator(".lyric-translation")).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath("translate-failed.png") });
      await mode(app, "ok");
      await panel.getByRole("button", { name: "Try Again", exact: true }).click();
      await expect(heavy.locator(".lyric-translation")).toHaveText("Heavy rain");
      await expect(panel.getByText("Couldn't translate the lyrics.")).toBeHidden();
    } finally {
      await app.close();
    }

    // A fresh app keeps Translate on and shows a saved translation with Google out of reach.
    const reopened = await launch();
    try {
      await fakeGoogle(reopened);
      await mode(reopened, "fail");
      const page = await reopened.firstWindow();
      await play(page, "Agua");
      await page.getByRole("button", { name: "Lyrics", exact: true }).click();
      const panel = page.getByRole("tabpanel");
      await expect(panel.getByRole("option", { name: "Espere pela água" })).toBeVisible({
        timeout: 90_000,
      });
      await expect(
        panel.getByRole("button", { name: "Translate Lyrics", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(panel.locator(".lyric-translation")).toHaveText([
        "Wait for the water",
        "Then go",
      ]);
      expect(await posts(reopened)).toEqual([]);
    } finally {
      await reopened.close();
    }
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
