import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

const SHOTS = process.env.WAVE_SHOTS_DIR;

for (const [lang, genres] of [
  ["en-US", "Genres"],
  ["pt-BR", "Gêneros"],
] as const)
  test(`a list longer than an hour reads in hours (${lang})`, async () => {
    const data = mkdtempSync(join(tmpdir(), "wave-e2e-durations-"));
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = (yield* Database) as unknown as TestDatabase;
        addTrack(db, { title: "Long One", genre: "Ambient", durationMs: 40 * 60_000 });
        addTrack(db, { title: "Long Two", genre: "Ambient", durationMs: 25 * 60_000 });
      }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
    );
    const app = await electron.launch({
      args: [join(import.meta.dirname, ".."), `--lang=${lang}`],
      env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
    });
    try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: genres, exact: true }).click();
      const row = page.getByRole("row", { name: /Ambient/ });
      // The table's Time column: hours, minutes and seconds, not "65:00".
      await expect(row).toContainText("1:05:00");
      await row.dblclick();
      await expect(page.getByTestId("hero")).toContainText("1 h 5 min");
      if (SHOTS !== undefined) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: join(SHOTS, `genre-hours-${lang}-${process.platform}.png`) });
      }
    } finally {
      await app.close();
      rmSync(data, { recursive: true, force: true });
    }
  });
