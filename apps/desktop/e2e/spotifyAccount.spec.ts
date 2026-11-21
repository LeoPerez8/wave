import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { catalogueOf } from "@wave/core";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");
const PHOTO =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2ioAAAAASUVORK5CYII=";
const ACCESS = "e2e-spotify-access";
const REFRESH = "e2e-spotify-refresh";

const launch = async (data: string, noKeyring = false) => {
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: {
      ...process.env,
      WAVE_DATA_DIR: data,
      WAVE_MUSIC_DIR: join(data, "Music"),
      WAVE_SPOTIFY_CLIENT_ID: "e2e-spotify-client",
    },
  });
  try {
    await app.evaluate(
      ({ shell, safeStorage }, fake) => {
        const realFetch = globalThis.fetch;
        if (fake.noKeyring) safeStorage.isEncryptionAvailable = () => false;
        shell.openExternal = async (url) => {
          const asked = new URL(url);
          if (asked.origin + asked.pathname !== "https://accounts.spotify.com/authorize")
            throw new Error("Expected Spotify's authorization page");
          const params = asked.searchParams;
          if (params.get("code_challenge_method") !== "S256" || !params.get("code_challenge"))
            throw new Error("Expected a PKCE challenge");
          const callback = new URL(params.get("redirect_uri")!);
          callback.searchParams.set("state", params.get("state")!);
          callback.searchParams.set("code", "e2e-spotify-code");
          await realFetch(callback);
        };
        globalThis.fetch = async (input, init) => {
          const revoked = process.env["WAVE_E2E_SPOTIFY_REVOKED"] === "1";
          switch (String(input)) {
            case "https://accounts.spotify.com/api/token":
              return revoked
                ? Response.json({ error: "invalid_grant" }, { status: 400 })
                : Response.json({
                    access_token: fake.access,
                    refresh_token: fake.refresh,
                    expires_in: 3600,
                  });
            case "https://api.spotify.com/v1/me":
              return revoked
                ? new Response(null, { status: 401 })
                : Response.json({
                    id: "ana",
                    display_name: "Ana",
                    images: [{ url: "https://i.scdn.co/image/ana" }],
                  });
            case "https://i.scdn.co/image/ana":
              return new Response(Buffer.from(fake.photo, "base64"), {
                headers: { "content-type": "image/png" },
              });
            default:
              return realFetch(input, init);
          }
        };
      },
      { noKeyring, access: ACCESS, refresh: REFRESH, photo: PHOTO },
    );
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
};

const spotifySettings = async (app: ElectronApplication) => {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  return { page, panel: page.getByRole("region", { name: "Spotify", exact: true }) };
};

test("Spotify Settings shows the profile, signs out and asks again after revocation", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-spotify-account-"));
  mkdirSync(join(data, "Music"));
  const file = join(data, "spotify-session.bin");
  let app: ElectronApplication | undefined;
  try {
    app = await launch(data);
    let { page, panel } = await spotifySettings(app);
    const signIn = () => panel.getByRole("button", { name: text.settings.signIn, exact: true });
    const signOut = () => panel.getByRole("button", { name: text.settings.signOut, exact: true });
    await signIn().click();
    await expect(panel).toContainText("Ana");
    const photo = panel.locator("img");
    await expect(photo).toHaveAttribute("src", `data:image/png;base64,${PHOTO}`);
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    const rendererView = await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.spotifyAccount.view(),
    );
    expect(JSON.stringify(rendererView)).not.toContain(ACCESS);
    expect(JSON.stringify(rendererView)).not.toContain(REFRESH);
    expect(Object.keys(rendererView).sort()).toEqual(["account", "configured", "keyringMissing"]);
    await page.screenshot({ path: join(appFolder, "test-results", "spotify-signed-in.png") });
    if (!rendererView.keyringMissing) {
      const sealed = readFileSync(file);
      expect(sealed.includes(ACCESS)).toBe(false);
      expect(sealed.includes(REFRESH)).toBe(false);
      await app.close();
      app = await launch(data);
      ({ page, panel } = await spotifySettings(app));
      await expect(panel).toContainText("Ana");
    }
    await signOut().click();
    await expect(signIn()).toBeVisible();
    expect(existsSync(file)).toBe(false);

    await signIn().click();
    await expect(signOut()).toBeVisible();
    await app.evaluate(() => {
      process.env["WAVE_E2E_SPOTIFY_REVOKED"] = "1";
    });
    await page.getByRole("button", { name: "Library", exact: true }).last().click();
    await page.getByRole("button", { name: "Accounts", exact: true }).click();
    await expect(panel.getByRole("button", { name: text.settings.signInAgain })).toBeVisible();
    await expect(panel).toContainText(text.settings.spotifyEndedYourSessionSoWaveIs);
    await page.screenshot({ path: join(appFolder, "test-results", "spotify-session-ended.png") });
  } finally {
    await app?.close();
    rmSync(data, { recursive: true, force: true });
  }
});

test("Spotify Settings explains a session without a keyring and forgets it on restart", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-spotify-no-keyring-"));
  mkdirSync(join(data, "Music"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(data, true);
    let { panel } = await spotifySettings(app);
    await panel.getByRole("button", { name: text.settings.signIn, exact: true }).click();
    await expect(panel).toContainText("Ana");
    await expect(panel).toContainText(text.desktopAccount.keyringMissing);
    expect(existsSync(join(data, "spotify-session.bin"))).toBe(false);
    await app.close();
    app = await launch(data, true);
    ({ panel } = await spotifySettings(app));
    await expect(
      panel.getByRole("button", { name: text.settings.signIn, exact: true }),
    ).toBeVisible();
  } finally {
    await app?.close();
    rmSync(data, { recursive: true, force: true });
  }
});
