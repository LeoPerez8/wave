import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

/**
 * Songs with no file on this computer and their artists show artwork found online (Deezer, as
 * the phone's artist photos), kept on disk. It asks the live service, so CI skips it.
 */
const appFolder = join(import.meta.dirname, "..");

const SONGS = [
  { title: "Pink Moon", artist: "Nick Drake", album: "Pink Moon", durationMs: 124000 },
  { title: "Airbag", artist: "Radiohead", album: "OK Computer", durationMs: 284000 },
  { title: "Teardrop", artist: "Massive Attack", album: "Mezzanine", durationMs: 330000 },
];

const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(appFolder, "test-results", `artwork-${name}.png`) });

test("missing songs, their albums and artists show artwork, kept for the next start", async () => {
  test.skip(process.env["CI"] !== undefined, "asks the live Deezer API");
  test.setTimeout(120000);
  const data = mkdtempSync(join(tmpdir(), "wave-artwork-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (const song of SONGS) addTrack(db, song);
      db.run(sql`UPDATE tracks SET path=NULL`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const launch = () =>
    electron.launch({
      args: [appFolder, "--lang=en-US"],
      env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
    });
  try {
    let app = await launch();
    let page = await app.firstWindow();
    await page.bringToFront();
    for (const [name, rows] of [
      ["Albums", 3],
      ["Artists", 3],
      ["Songs", 3],
    ] as const) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.locator("[role=grid] .artwork img")).toHaveCount(rows, { timeout: 30000 });
      await shot(page, name.toLowerCase());
    }
    await app.close();
    expect(readdirSync(join(data, "online-artwork")).length).toBeGreaterThanOrEqual(6);

    // A second start reads the covers from disk: they show at once.
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("button", { name: "Albums", exact: true }).click();
    await expect(page.locator("[role=grid] .artwork img")).toHaveCount(3, { timeout: 5000 });
    await app.close();
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
