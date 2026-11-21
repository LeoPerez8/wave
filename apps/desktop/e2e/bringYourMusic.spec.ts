import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { catalogueOf } from "@wave/core";

import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * First run's Bring your music card over the built app: it follows the invitation to sign in,
 * comes back on the next start while unanswered, turns YT Music on, opens From Spotify's picker
 * (against a fake of Spotify's sign-in and Web API) and YouTube's sign-in, and is answered for
 * good by Continue, Not Now and Escape.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");
const card = text.settings.bringYourMusic;

const launch = async (data: string) => {
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: {
      ...process.env,
      WAVE_DATA_DIR: data,
      WAVE_MUSIC_DIR: join(data, "Music"),
      // Nothing goes to the service unless Sign In is clicked.
      WAVE_SYNC_URL: "http://127.0.0.1:9",
      WAVE_GOOGLE_DESKTOP_CLIENT_ID: "e2e-client",
      WAVE_SPOTIFY_CLIENT_ID: "e2e-spotify-client",
    },
  });
  try {
    await app.evaluate(({ shell }) => {
      const realFetch = globalThis.fetch;
      shell.openExternal = async (url) => {
        const asked = new URL(url);
        if (asked.origin + asked.pathname !== "https://accounts.spotify.com/authorize")
          throw new Error("Expected Spotify's authorization page");
        const callback = new URL(asked.searchParams.get("redirect_uri")!);
        callback.searchParams.set("state", asked.searchParams.get("state")!);
        callback.searchParams.set("code", "e2e-spotify-code");
        await realFetch(callback);
      };
      const list = (items: readonly unknown[]) => ({ items, total: items.length, next: null });
      const api = (url: URL): unknown => {
        switch (url.pathname) {
          case "/v1/me":
            return { id: "ana", display_name: "Ana", images: [] };
          case "/v1/me/tracks":
            return list([]);
          case "/v1/me/playlists":
            return list([{ id: "road", name: "Road trip", images: [], items: { total: 0 } }]);
          case "/v1/playlists/road/items":
            return list([]);
          default:
            return undefined;
        }
      };
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.href === "https://accounts.spotify.com/api/token")
          return Response.json({ access_token: "a", refresh_token: "r", expires_in: 3600 });
        if (url.origin !== "https://api.spotify.com") return realFetch(input, init);
        const answer = api(url);
        return answer === undefined ? new Response(null, { status: 403 }) : Response.json(answer);
      };
    });
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
};

/** YouTube's sign-in starts a browser: once the window's bridge is up, count the calls instead. */
const countYtSignIns = (app: ElectronApplication) =>
  app.evaluate(({ ipcMain }) => {
    const counted = globalThis as unknown as { ytSignIns: number };
    counted.ytSignIns = 0;
    ipcMain.removeHandler("ytAccount.signIn");
    ipcMain.handle("ytAccount.signIn", () => {
      counted.ytSignIns += 1;
    });
  });

const withData = async (run: (data: string) => Promise<void>) => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-bring-your-music-"));
  mkdirSync(join(data, "Music"));
  try {
    await run(data);
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
};

/** Opens Wave and answers the invitation, which leaves the card. */
const pastInvitation = async (app: ElectronApplication) => {
  const page = await app.firstWindow();
  const invitation = page.getByTestId("invitation");
  await expect(invitation).toBeVisible();
  await expect(page.getByTestId("bring-your-music")).toHaveCount(0);
  await invitation.getByRole("button", { name: text.settings.signInInvitation.notNow }).click();
  await expect(page.getByTestId("bring-your-music")).toBeVisible();
  return page;
};

test("Bring your music follows the invitation, comes back unanswered, and imports from Spotify", async () => {
  test.setTimeout(180_000);
  await withData(async (data) => {
    let app = await launch(data);
    try {
      let page = await pastInvitation(app);
      await page.evaluate(() =>
        (window as unknown as { wave: WaveBridge }).wave.settings.setYtMusic(false),
      );
      // Closed before it was answered: the next start shows the card, not the invitation.
      await app.close();
      app = await launch(data);
      const main = app;
      page = await app.firstWindow();
      const bring = page.getByTestId("bring-your-music");
      await expect(bring).toBeVisible();
      await expect(page.getByTestId("invitation")).toHaveCount(0);
      await countYtSignIns(main);
      await expect(bring.getByRole("heading", { name: card.title })).toBeVisible();

      // YT Music is off: the card says importing needs it, and turns it on.
      const fromSpotify = bring.getByRole("button", { name: text.imports.fromSpotify });
      const fromYtMusic = bring.getByRole("button", { name: text.imports.fromYtMusic });
      await expect(bring).toContainText(card.needsYtMusic);
      await expect(fromSpotify).toHaveCount(0);
      await bring.getByRole("button", { name: card.turnOnYtMusic }).click();
      await expect(fromSpotify).toBeVisible();
      await expect(fromYtMusic).toBeVisible();
      await expect(bring.getByRole("button", { name: text.imports.continue })).toHaveCount(0);
      await page.screenshot({ path: join(appFolder, "test-results", "bring-your-music.png") });

      // From YT Music opens YouTube's sign-in and Settings › Accounts, where its playlists show.
      await expect(page.getByTestId("yt-account-settings")).toHaveCount(0);
      await fromYtMusic.click();
      await expect(page.getByTestId("yt-account-settings")).toBeVisible();
      await expect
        .poll(() => main.evaluate(() => (globalThis as unknown as { ytSignIns: number }).ytSignIns))
        .toBe(1);

      // From Spotify signs in and opens Import Playlists' picker; Import marks the source.
      await fromSpotify.click();
      const picker = page.getByRole("dialog", { name: text.imports.importFromSpotify });
      await picker.getByRole("checkbox", { name: /Road trip/ }).check();
      await picker.getByRole("button", { name: text.imports.import, exact: true }).click();
      await expect(page.getByTestId("importing-spotify")).toHaveText(text.settings.importing);
      await expect(page.getByTestId("importing-ytMusic")).toHaveCount(0);
      await expect(async () => {
        if (await picker.isVisible())
          await picker.getByRole("button", { name: text.imports.cancel }).click({ timeout: 1000 });
        await expect(picker).toHaveCount(0, { timeout: 1000 });
      }).toPass();

      // Continue answers the card for good.
      await bring.getByRole("button", { name: text.imports.continue }).click();
      await expect(bring).toHaveCount(0);
      await app.close();
      app = await launch(data);
      page = await app.firstWindow();
      await expect(page.getByTestId("song-count")).toBeVisible();
      await expect(page.getByTestId("bring-your-music")).toHaveCount(0);
      await expect(page.getByTestId("invitation")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});

for (const answer of ["Not Now", "Escape"] as const)
  test(`${answer} answers Bring your music for good on this computer`, async () => {
    await withData(async (data) => {
      let app = await launch(data);
      try {
        let page = await pastInvitation(app);
        const notNow = page
          .getByTestId("bring-your-music")
          .getByRole("button", { name: text.settings.signInInvitation.notNow });
        if (answer === "Not Now") await notNow.click();
        else await notNow.press("Escape");
        await expect(page.getByTestId("bring-your-music")).toHaveCount(0);
        await app.close();
        app = await launch(data);
        page = await app.firstWindow();
        await expect(page.getByTestId("song-count")).toBeVisible();
        await expect(page.getByTestId("bring-your-music")).toHaveCount(0);
      } finally {
        await app.close();
      }
    });
  });
