import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { keepLyricsSearchText } from "@wave/client/db/lyricsSearchIndex";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";
import { fakeGeniusService, GENIUS_E2E_CLIENT, geniusReply } from "./geniusFixture.ts";

/**
 * Search's online lyrics over the built app, against the sync service in memory and a fake
 * Genius: the three-word rule, each state's line and action, five hits then twenty, the hit a
 * Library Lyrics row already shows, and what a click does with YT Music off.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");
const QUERY = "love love is a verb";
const ROUTE = "/v1/genius/search?q=love%20love%20is%20a%20verb";

const hit = (id: number, title: string, artist: string) => ({
  type: "song",
  result: {
    id,
    title,
    url: `https://genius.com/songs/${id}`,
    primary_artist: { name: artist },
    artist_names: artist,
  },
});

/** Teardrop is a Lyrics row of the Library, Angel a Library song, the rest are only on Genius. */
const answer = (url: URL) =>
  geniusReply({
    hits:
      url.pathname === "/search" && url.searchParams.get("q") === QUERY
        ? [
            hit(1, "Teardrop", "Massive Attack"),
            hit(2, "Angel", "Massive Attack"),
            ...Array.from({ length: 23 }, (_, index) =>
              hit(10 + index, `Verb Song ${index + 1}`, "Ghost Band"),
            ),
          ]
        : [],
  });

/** A one-second silent mono WAV at [path]. */
const silence = (path: string) => {
  const rate = 8_000;
  const wave = Buffer.alloc(44 + rate * 2);
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

const playing = (page: Page) =>
  page.evaluate(async () => {
    const view = await (window as unknown as { wave: WaveBridge }).wave.playback.view();
    return view.current?.title;
  });

test("Search finds lyrics online with Genius, with each state's line and a click that plays", async () => {
  test.setTimeout(120_000);
  const data = mkdtempSync(join(tmpdir(), "wave-genius-search-"));
  const service = await fakeGeniusService(answer);
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = (yield* Database) as unknown as TestDatabase;
        for (const title of ["Teardrop", "Angel"]) {
          const path = join(data, `${title}.wav`);
          silence(path);
          const id = addTrack(db, { title, artist: "Massive Attack", album: "Mezzanine" });
          db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
          if (title === "Teardrop")
            keepLyricsSearchText(db, id, "Love love is a verb\nLove is a doing word");
        }
      }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
    );
    const app = await electron.launch({
      args: [appFolder, "--lang=en-US"],
      env: {
        ...process.env,
        WAVE_DATA_DIR: data,
        WAVE_MUSIC_DIR: join(data, "Absent"),
        WAVE_SYNC_URL: service.url,
        WAVE_GOOGLE_DESKTOP_CLIENT_ID: GENIUS_E2E_CLIENT,
        WAVE_GOOGLE_TOKEN_URL: `${service.url}/token`,
      },
    });
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
      // With YT Music off nothing leaves for YouTube, and a hit the Library lacks opens on Genius.
      await page.evaluate(() =>
        (window as unknown as { wave: WaveBridge }).wave.settings.setYtMusic(false),
      );
      const field = page.getByRole("searchbox", { name: text.desktopLayout.search });
      const section = page.getByTestId("search-online-lyrics");
      const hits = page.getByTestId("search-online-lyric");
      const search = async (query: string) => {
        await field.fill("");
        await field.fill(query);
      };

      // Two words ask nothing; signed out, three or more show the line and Sign In.
      await search("love love");
      await expect(page.getByTestId("search-lyric")).toHaveCount(1);
      await page.waitForTimeout(800);
      await expect(section).toHaveCount(0);
      await search(QUERY);
      await expect(section).toContainText("Sign in to a Wave account to search lyrics online");
      expect(service.state.routes).toEqual([]);
      await section.getByRole("button", { name: "Sign In", exact: true }).click();
      const settings = page.getByTestId("account-settings");
      await settings.getByRole("button", { name: "Sign In with Google" }).click();
      await expect(settings).toContainText("Ana");

      // A failed request shows its line; Try Again asks once more.
      service.state.fail = true;
      await search(QUERY);
      await expect(section).toContainText("Couldn't search lyrics online");
      service.state.fail = false;
      await section.getByRole("button", { name: "Try Again", exact: true }).click();
      // Five hits after the local results, without the song the Library's Lyrics row shows.
      await expect(hits).toHaveCount(5);
      await expect(page.getByTestId("search-lyric")).toHaveText([/^Teardrop/]);
      await expect(hits.first()).toContainText("Angel");
      await expect(hits.filter({ hasText: "Teardrop" })).toHaveCount(0);
      await expect(section.getByRole("heading")).toHaveText("Lyrics online · 20");
      expect(
        await section.evaluate(
          (node) =>
            !!(
              document
                .querySelector('[data-testid="search-lyrics"]')!
                .compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING
            ),
        ),
      ).toBe(true);
      await page.screenshot({ path: test.info().outputPath("genius-lyrics-search.png") });
      await section.getByRole("button", { name: "Show all 20" }).click();
      await expect(hits).toHaveCount(20);
      expect(service.state.routes).toEqual([ROUTE, ROUTE]);

      // A click plays the Library's song; a song only Genius has opens its page.
      await hits.filter({ hasText: "Angel" }).dblclick();
      await expect.poll(() => playing(page)).toBe("Angel");
      // One click resolves at a time: the next is taken once this one settled.
      await expect(hits.filter({ hasText: "Angel" })).toHaveAttribute("aria-busy", "false");
      await app.evaluate(({ shell }) => {
        const opened: string[] = [];
        (globalThis as { openedPages?: string[] }).openedPages = opened;
        shell.openExternal = async (href: string) => void opened.push(href);
      });
      await hits.filter({ hasText: "Verb Song 1" }).first().dblclick();
      await expect
        .poll(() => app.evaluate(() => (globalThis as { openedPages?: string[] }).openedPages))
        .toEqual(["https://genius.com/songs/10"]);
      expect(await playing(page)).toBe("Angel");

      // Without a connection the section says so, and asks again when it is back.
      await app.evaluate(({ net }) => {
        Object.defineProperty(net, "isOnline", { value: () => false, configurable: true });
      });
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await expect(section).toContainText("No connection");
      await expect(hits).toHaveCount(0);
      await app.evaluate(({ net }) => {
        Object.defineProperty(net, "isOnline", { value: () => true, configurable: true });
      });
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(hits).toHaveCount(20);

      // With "Genius insights" off the section is gone and nothing is asked.
      const asked = service.state.routes.length;
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Lyrics and tags", exact: true }).click();
      await page.getByRole("switch", { name: "Genius insights" }).uncheck();
      await search(QUERY);
      await expect(page.getByTestId("search-lyric")).toHaveCount(1);
      await page.waitForTimeout(800);
      await expect(section).toHaveCount(0);
      expect(service.state.routes).toHaveLength(asked);
    } finally {
      await app.close();
    }
  } finally {
    service.close();
    rmSync(data, { recursive: true, force: true });
  }
});
