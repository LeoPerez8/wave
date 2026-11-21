import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { fakeGeniusService, GENIUS_E2E_CLIENT as CLIENT, geniusReply } from "./geniusFixture.ts";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
const DESCRIPTION = "First line.\nSecond line.\nThird line.\nFourth line.";
const SONG_ID = 9;

const annotation = (id: number, fragment: string, plain: string) => ({
  id,
  song_id: SONG_ID,
  fragment,
  annotations: [{ body: { plain }, state: "pending", authors: [{ user: { name: "Ana" } }] }],
});

const answer = (url: URL) => {
  if (url.pathname === "/search") {
    if (url.searchParams.get("q") !== "Teardrop Massive Attack") return geniusReply({ hits: [] });
    return geniusReply({
      hits: [
        {
          type: "song",
          result: {
            id: SONG_ID,
            title: "Teardrop",
            url: "https://genius.com/example",
            primary_artist: { name: "Massive Attack" },
          },
        },
      ],
    });
  }
  if (url.pathname === `/songs/${SONG_ID}`)
    return geniusReply({ song: { id: SONG_ID, description: { plain: DESCRIPTION } } });
  return geniusReply({
    referents: [
      annotation(1, "for the water", "A note about the water."),
      annotation(2, "[Bridge]", "A note about the bridge."),
    ],
  });
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

const play = async (page: Page, title: string) => {
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("row", { name: new RegExp(title) }).dblclick();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  await page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.playback.pause());
};

const position = (page: Page) =>
  page.evaluate(async () => {
    const { status } = await (window as unknown as { wave: WaveBridge }).wave.playback.view();
    return status.positionMs;
  });

test("Genius insights follow Lyrics, keep the answer offline and obey the synced switch", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-genius-"));
  const service = await fakeGeniusService(answer);
  const launch = () =>
    electron.launch({
      args: [appFolder, "--lang=en-US"],
      env: {
        ...process.env,
        WAVE_DATA_DIR: data,
        WAVE_MUSIC_DIR: join(data, "Absent"),
        WAVE_SYNC_URL: service.url,
        WAVE_GOOGLE_DESKTOP_CLIENT_ID: CLIENT,
        WAVE_GOOGLE_TOKEN_URL: `${service.url}/token`,
      },
    });
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = (yield* Database) as unknown as TestDatabase;
        for (const title of [
          "Teardrop",
          "Unknown to Genius",
          "Never looked up",
          "Cancel request",
        ]) {
          const path = join(data, `${title}.wav`);
          writeSong(path);
          writeFileSync(
            join(data, `${title}.lrc`),
            "[00:00.00]Wait for the water\n[00:20.00]Then go\n",
          );
          const id = addTrack(db, { title, artist: "Massive Attack", durationMs: 30_000 });
          db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
        }
      }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
    );
    const app = await launch();
    try {
      // Answer the browser redirect with the test account, without opening Google's site.
      await app.evaluate(({ shell }) => {
        shell.openExternal = async (href: string) => {
          const asked = new URL(href).searchParams;
          const back = new URL(asked.get("redirect_uri")!);
          back.searchParams.set("code", "test-code");
          back.searchParams.set("state", asked.get("state")!);
          await fetch(back);
        };
      });
      const page = await app.firstWindow();
      await page.getByTestId("invitation").getByRole("button", { name: "Not Now" }).click();
      await play(page, "Teardrop");
      const lyrics = page.getByRole("button", { name: "Lyrics", exact: true });
      await lyrics.click();
      const panel = page.getByRole("tabpanel");
      await expect(panel.getByRole("option", { name: "Wait for the water" })).toBeVisible();
      await expect(panel).toContainText("Sign in to a Wave account to see what Genius says");
      await panel.getByRole("button", { name: "Sign In", exact: true }).click();
      const settings = page.getByTestId("account-settings");
      await expect(settings).toBeVisible();
      expect(service.state.routes).toEqual([]);

      // Signing in while the lyrics are visible starts the request. Its failure leaves lyrics usable.
      let release = () => {};
      service.state.wait = new Promise<void>((resolve) => (release = resolve));
      service.state.fail = true;
      await settings.getByRole("button", { name: "Sign In with Google" }).click();
      await expect(panel.getByText("Loading Genius insights…")).toBeVisible();
      await expect(panel.getByRole("option", { name: "Wait for the water" })).toBeVisible();
      release();
      await expect(panel.getByText("Couldn't load Genius insights")).toBeVisible();
      service.state.fail = false;
      await panel.getByRole("button", { name: "Try Again", exact: true }).click();
      const about = panel.getByRole("button", { name: "About · Genius" });
      await expect(about).toHaveAttribute("aria-expanded", "false");
      await expect(about.locator(".genius-copy")).toHaveCSS("-webkit-line-clamp", "3");
      await about.click();
      await expect(about).toHaveAttribute("aria-expanded", "true");
      await expect(about).toContainText("Fourth line.");
      await about.click();
      await expect(about).toHaveAttribute("aria-expanded", "false");
      await page.screenshot({ path: test.info().outputPath("genius-panel.png") });

      const highlight = panel.getByRole("button", { name: "Genius annotation on for the water" });
      const dialog = page.getByRole("dialog", { name: /Genius annotation on/ });
      await highlight.click();
      await expect(dialog).toContainText("A note about the water.");
      await expect(dialog).toContainText("By Ana");
      await expect(dialog).toContainText("Unreviewed");
      expect(await position(page)).toBeLessThan(20_000);
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await panel.getByRole("option", { name: "Then go" }).click();
      await expect.poll(() => position(page)).toBe(20_000);
      await panel.getByRole("heading", { name: "More insights" }).scrollIntoViewIfNeeded();
      await panel.getByRole("button", { name: /Bridge.*A note about the bridge/ }).click();
      await expect(dialog).toContainText("A note about the bridge.");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      await page.getByTitle("Opens Now Playing").click();
      const nowPlaying = page.getByRole("dialog", { name: "Now Playing", exact: true });
      await expect(nowPlaying.getByRole("button", { name: "About · Genius" })).toBeVisible();
      await nowPlaying.getByRole("button", { name: "Genius annotation on for the water" }).click();
      await expect(dialog).toContainText("By Ana");
      await page.screenshot({ path: test.info().outputPath("genius-now-playing.png") });
      await page.keyboard.press("Escape");
      await expect(nowPlaying).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(nowPlaying).toBeHidden();
      expect(service.state.routes).toEqual([
        "/v1/genius/search?q=Teardrop%20Massive%20Attack",
        "/v1/genius/search?q=Teardrop%20Massive%20Attack",
        "/v1/genius/song?id=9",
        "/v1/genius/referents?song=9&page=1",
      ]);

      await play(page, "Unknown to Genius");
      await expect(panel.getByText("Genius has no insights for this song")).toBeVisible();
      await lyrics.click();
      await play(page, "Never looked up");
      const beforeOff = service.state.routes.length;
      expect(beforeOff).toBe(5);
      await lyrics.click();
      await expect(panel.getByText("Genius has no insights for this song")).toBeVisible();

      // Turning the synced switch off while a route is outstanding aborts the request.
      let releaseCancellation = () => {};
      service.state.wait = new Promise<void>((resolve) => (releaseCancellation = resolve));
      const routesBeforeCancellation = service.state.routes.length;
      await play(page, "Cancel request");
      await expect.poll(() => service.state.routes.length).toBe(routesBeforeCancellation + 1);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Lyrics and tags", exact: true }).click();
      const toggle = page.getByRole("switch", { name: "Genius insights" });
      await toggle.uncheck();
      await expect.poll(() => service.state.aborted).toBe(1);
      releaseCancellation();
      service.state.wait = Promise.resolve();
      await expect.poll(() => service.state.routes.length).toBe(routesBeforeCancellation + 1);

      // Turn off a saved song's insights while Lyrics is still showing.
      if (!(await toggle.isChecked())) await toggle.check();
      await play(page, "Teardrop");
      await expect(about).toBeVisible();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Lyrics and tags", exact: true }).click();
      await expect(toggle).toBeChecked();
      await toggle.uncheck();
      await expect(about).toBeHidden();
      await expect(highlight).toBeHidden();
      await expect(panel.getByRole("heading", { name: "More insights" })).toBeHidden();
      const whileOff = service.state.routes.length;
      await play(page, "Unknown to Genius");
      await expect(panel.getByRole("option", { name: "Wait for the water" })).toBeVisible();
      await expect(panel.getByText("Genius has no insights for this song")).toBeHidden();
      expect(service.state.routes).toHaveLength(whileOff);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await toggle.check();
      await expect(panel.getByText("Genius has no insights for this song")).toBeVisible();
    } finally {
      await app.close();
    }

    // A fresh app reads the device's saved answer even though the service is unavailable.
    service.state.offline = true;
    const beforeReopen = service.state.routes.length;
    const reopened = await launch();
    try {
      const page = await reopened.firstWindow();
      await play(page, "Teardrop");
      await page.getByRole("button", { name: "Lyrics", exact: true }).click();
      await expect(page.getByRole("button", { name: "About · Genius" })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Genius annotation on for the water" }),
      ).toBeVisible();
      expect(service.state.routes).toHaveLength(beforeReopen);
    } finally {
      await reopened.close();
    }
  } finally {
    service.close();
    rmSync(data, { recursive: true, force: true });
  }
});
