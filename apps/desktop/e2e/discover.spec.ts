import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";
import { stubDiscover } from "./discoverFixture.ts";

const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");

test("Home groups Discover's rows in the phone's order, plays a Genre mix from its tile's glyph, opens its settings and hides Discover offline or with YT Music off", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-home-discover-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (const title of ["Pink Moon", "Place to Be", "Road"]) addTrack(db, { title });
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const played = await stubDiscover(app);
    await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.settings.setYtMusic(true),
    );
    await page.reload();
    const home = page.getByTestId("home");
    const discover = home.getByRole("region", { name: text.home.sections.discover, exact: true });
    await expect(discover.getByRole("heading")).toHaveText([
      text.home.sections.discover,
      text.discover.rows["magic-queue"],
      text.discover.rows["artist-mixes"],
      text.discover.rows["genre-mixes"],
    ]);
    // Discover sits where the phone's default order puts it: before Recently added.
    await expect(home.locator("h2").first()).toHaveText(text.home.sections.discover);
    await expect(
      discover.getByRole("region", { name: text.discover.rows["magic-queue"] }).locator(".tile"),
    ).toHaveCount(3);
    await page.screenshot({ path: test.info().outputPath("home-discover.png") });

    // A tile's play glyph plays the mix; the tile itself opens its page (discoverMix.spec.ts).
    await discover
      .getByRole("button", {
        name: text.playbackText.playValue(text.discover.mixTitle("Electronic")),
        exact: true,
      })
      .click();
    expect(await played.jsonValue()).toEqual([["genre:electronic", 0]]);

    await discover.getByRole("button", { name: text.discover.settings }).click();
    const card = page.getByRole("dialog", { name: text.home.sections.discover });
    const newMusic = card.getByRole("slider", { name: text.discover.newMusic });
    await expect(newMusic).toHaveValue("3");
    await expect(newMusic).toBeFocused();
    await expect(card.getByRole("slider", { name: text.discover.genreFaithfulness })).toBeVisible();
    await expect(card.getByRole("slider", { name: text.discover.popularity })).toBeVisible();
    await newMusic.press("End");
    await expect(newMusic).toHaveValue("5");
    await expect(card).toContainText(text.discover.levels[5]);
    await page.screenshot({ path: test.info().outputPath("discover-settings.png") });
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.discover.settings()),
      )
      .toEqual({ level: 5, faithfulness: 3, popularity: 3 });
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    await expect(discover.getByRole("button", { name: text.discover.settings })).toBeFocused();

    await page.context().setOffline(true);
    await expect(discover).toHaveCount(0);
    await expect(home.getByRole("alert")).toHaveCount(0);
    await page.context().setOffline(false);
    await expect(discover).toBeVisible();

    await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.settings.setYtMusic(false),
    );
    await page.reload();
    await expect(
      home.getByRole("region", { name: text.home.sections["recently-added"] }),
    ).toBeVisible();
    await expect(discover).toHaveCount(0);
    await expect(home.getByRole("alert")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("home-yt-off.png") });
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
