import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";
import {
  assertWindowReady,
  assessFrames,
  processTreeMemory,
  readProcessMemory,
} from "../scripts/performance.ts";

const appFolder = join(import.meta.dirname, "..");

test("desktop launch, 50,000-song scrolling and whole-app memory meet the release targets", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-performance-"));
  const report: Record<string, unknown> = {
    schema: 1,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    ref: process.env["GITHUB_REF"] ?? null,
    platform: process.platform,
    arch: process.arch,
    songs: 50000,
    profile: "signed-out, YT Music off, no artwork, no audio playing",
    status: "incomplete",
    limits: {
      readyMsExclusive: 2000,
      p95DisplayFrames: 1.5,
      missedFrameRatio: 0.05,
      incompleteFrameRatio: 0.05,
    },
  };
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    // Match the layout fixture's transaction-sized seeding. No scan runs over fake paths.
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = (yield* Database) as unknown as TestDatabase;
        const first = addTrack(db, {
          title: "Song 00000",
          artist: "Performance artist",
          album: "Performance album",
          durationMs: 180000,
        });
        db.run(sql`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<49999)
          INSERT INTO tracks (path,folder_id,file_name,size_bytes,modified_at,title,title_sort,artist_id,artist_credit,album_id,duration_ms,added_at,scanned_at)
          SELECT '/Music/perf/'||x||'.flac',folder_id,x||'.flac',1,1,printf('Song %05d',x),printf('song %05d',x),artist_id,artist_credit,album_id,180000,1,1 FROM tracks,n WHERE tracks.id=${first}`);
        db.run(sql`INSERT INTO desktop_settings (key,value) VALUES ('settings.ytMusic','off')`);
      }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
    );
    const launch = performance.now();
    const launchedAt = Date.now();
    app = await electron.launch({
      args: [appFolder, "--lang=en-US"],
      env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
    });
    const page = await app.firstWindow();
    const windowMs = performance.now() - launch;
    // Ready is Home, the first page, drawn from the library and painted, not just ready-to-show:
    // its sections are in the page and its heading counts the 50,000 songs.
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="home"] [data-section]') !== null &&
        document.querySelector('[data-testid="song-count"]')?.textContent?.includes("50,000") ===
          true,
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const readyMs = performance.now() - launch;
    report["readyMs"] = readyMs;
    // Where the time went, by the page's own clock. Only readyMs is held to the limit.
    report["startup"] = {
      windowOpenedMs: windowMs,
      pageStartedMs: (await page.evaluate(() => performance.timeOrigin)) - launchedAt,
      pageLoadedMs:
        (await page.evaluate(
          () => performance.timeOrigin + performance.getEntriesByType("navigation")[0]!.duration,
        )) - launchedAt,
    };
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()),
    ).toBe(true);
    await page.bringToFront();
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    const table = page.getByRole("grid", { name: "Songs", exact: true });
    await expect(table).toHaveAttribute("aria-rowcount", "50001");
    await expect(page.locator("#library-row-0")).toContainText("Song 00000");

    // Confirm both shipped backends work before recording rest; never measure missing services.
    await page.evaluate(
      async (fixture) => {
        const wave = (window as unknown as { wave: WaveBridge }).wave;
        await wave.tags.read(fixture);
        await wave.player.status();
      },
      join(appFolder, "native/engine/tests/fixtures/tone.flac"),
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { wave: WaveBridge }).wave.library
            .scanStatus()
            .then((s) => s.status),
        ),
      )
      .not.toBe("scanning");
    await page.waitForTimeout(5000);
    await page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.player.status());
    const mainPid = await app.evaluate(() => process.pid);
    const memory = processTreeMemory(mainPid, readProcessMemory());
    const roles = await app.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map(({ pid, type, name, serviceName }) => ({ pid, type, name, serviceName })),
    );
    report["memoryAtRest"] = {
      ...memory,
      electronProcesses: roles,
      measuredAt: new Date().toISOString(),
      idleMs: 5000,
      metric: "sum of OS resident working sets; shared pages may be counted more than once",
    };
    expect(memory.processes.some((p) => /^java(?:\.exe)?$/.test(p.name))).toBe(true);
    expect(memory.totalRssBytes).toBeGreaterThan(0);

    const idle = await page.evaluate(async () => {
      const samples: number[] = [];
      let last = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      for (let i = 0; i < 60; i++) {
        const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        samples.push(now - last);
        last = now;
      }
      return samples;
    });
    const segments = [];
    // Visit uncached pages near the beginning, middle and end of the full library.
    for (const row of [0, 24500, 49500]) {
      await page.locator(".table-viewport").evaluate((element, row) => {
        element.scrollTop = row * 40;
      }, row);
      await expect(page.locator(`#library-row-${row}`)).toContainText(
        `Song ${String(row).padStart(5, "0")}`,
      );
      const frames = await page.locator(".table-viewport").evaluate(async (element) => {
        const intervals: number[] = [];
        let incompleteFrames = 0;
        const incompleteAt: { frame: number; first: number; rendered: number[] }[] = [];
        let maxRows = 0;
        let last = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        for (let i = 0; i < 120; i++) {
          element.scrollTop += 80;
          const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
          intervals.push(now - last);
          last = now;
          const rows = [...element.querySelectorAll<HTMLElement>("[data-row]")];
          maxRows = Math.max(maxRows, rows.length);
          const first = Math.floor(element.scrollTop / 40);
          const end = Math.ceil((element.scrollTop + element.clientHeight) / 40);
          const indices = new Set(rows.map((r) => Number(r.dataset["row"])));
          if (
            Array.from({ length: end - first }, (_, i) => first + i).some(
              (index) => !indices.has(index),
            )
          ) {
            incompleteFrames++;
            incompleteAt.push({ frame: i, first, rendered: [...indices].sort((a, b) => a - b) });
          }
        }
        return {
          intervals,
          incompleteFrames,
          incompleteAt,
          maxRows,
          endScrollTop: element.scrollTop,
        };
      });
      segments.push({
        startRow: row,
        ...frames,
        ...assessFrames(idle, frames.intervals, frames.incompleteFrames),
      });
    }
    report["scroll"] = { idleFrameIntervalsMs: idle, segments };
    report["status"] = "failed";
    assertWindowReady(readyMs);
    for (const segment of segments) {
      expect(segment, `Scroll near row ${segment.startRow}`).toMatchObject({ passed: true });
      expect(segment.maxRows).toBeLessThan(50);
      expect(segment.endScrollTop).toBeGreaterThan(segment.startRow * 40);
    }
    report["status"] = "passed";
  } finally {
    const folder = join(appFolder, "perf-results");
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `desktop-performance-${process.platform}.json`);
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    await test
      .info()
      .attach("desktop-performance", { path: file, contentType: "application/json" });
    await app?.close();
    rmSync(data, { recursive: true, force: true });
  }
});
