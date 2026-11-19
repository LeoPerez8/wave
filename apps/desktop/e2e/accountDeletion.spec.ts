import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { catalogueOf } from "@wave/core";
import { harness, type Harness } from "../../sync/src/testing.ts";

const appFolder = join(import.meta.dirname, "..");
const CLIENT = "e2e-client";
const text = catalogueOf("en", "desktop");
/** Where the screenshots go: `WAVE_SHOTS_DIR` for a check's notes, the test results otherwise. */
const shots = process.env["WAVE_SHOTS_DIR"] ?? join(appFolder, "test-results");

/**
 * Wave's sync service and Google's token endpoint on this computer: the sync Worker's test
 * harness behind HTTP, with a fake Google that signs in as [googleSubject]. Nothing here
 * reaches the deployed service or a real account.
 */
const fakeService = async () => {
  const service: Harness = await harness({ googleDesktopClientId: CLIENT });
  const state = {
    googleSubject: "google-sub-1",
    down: false,
    /** Delete Account's request waits for this before the service answers it. */
    hold: Promise.resolve(),
  };
  const server: Server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString("utf8");
      if (request.url === "/token") {
        const idToken = await service.google.idToken({
          aud: CLIENT,
          sub: state.googleSubject,
          name: "Ana",
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id_token: idToken }));
        return;
      }
      if (state.down && request.method === "DELETE") {
        response.writeHead(503).end();
        return;
      }
      if (request.method === "DELETE" && request.url === "/v1/account") await state.hold;
      const headers: Record<string, string> = {};
      for (const name of ["authorization", "content-type"]) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const answer = await service.request(request.method ?? "GET", request.url ?? "/", {
        headers,
        ...(body === "" ? {} : { body }),
      });
      response.writeHead(answer.status, Object.fromEntries(answer.headers));
      response.end(Buffer.from(await answer.arrayBuffer()));
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    state,
    accounts: async () =>
      Number((await service.db.execute("SELECT COUNT(*) AS n FROM accounts")).rows[0]?.["n"]),
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
};

/** In place of the browser: answers Google's redirect at once, as a sign-in that worked. */
const signInWithoutBrowser = (app: ElectronApplication) =>
  app.evaluate(({ shell }) => {
    shell.openExternal = async (url: string) => {
      const asked = new URL(url).searchParams;
      const back = new URL(asked.get("redirect_uri")!);
      back.searchParams.set("code", "e2e-code");
      back.searchParams.set("state", asked.get("state")!);
      await fetch(back);
    };
  });

test("Delete Account asks first, says when it fails, then deletes the account and keeps the Library", async () => {
  const service = await fakeService();
  const data = mkdtempSync(join(tmpdir(), "wave-delete-account-"));
  const music = join(data, "Music");
  mkdirSync(music);
  const song = join(music, "tagged.flac");
  copyFileSync(
    join(appFolder, "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/tagged.flac"),
    song,
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: {
      ...process.env,
      WAVE_DATA_DIR: data,
      WAVE_MUSIC_DIR: music,
      WAVE_SYNC_URL: service.origin,
      WAVE_GOOGLE_DESKTOP_CLIENT_ID: CLIENT,
      WAVE_GOOGLE_TOKEN_URL: `${service.origin}/token`,
    },
  });
  try {
    await signInWithoutBrowser(app);
    const page = await app.firstWindow();
    const oneSong = text.library.songCount(1);
    await expect(page.getByTestId("song-count")).toHaveText(oneSong, { timeout: 30000 });
    await page.getByTestId("invitation").getByRole("button", { name: "Not Now" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Accounts", exact: true }).click();
    const settings = page.getByTestId("account-settings");
    const deleteAccount = settings.getByRole("button", { name: "Delete Account", exact: true });

    // Signed out, there is nothing to delete.
    await expect(settings.getByRole("button", { name: "Sign In with Google" })).toBeVisible();
    await expect(deleteAccount).toHaveCount(0);
    await page.screenshot({ path: join(shots, "delete-account-1-signed-out.png") });

    await settings.getByRole("button", { name: "Sign In with Google" }).click();
    await expect(page.getByTestId("account-name")).toContainText("Ana");
    await expect(deleteAccount).toBeVisible();
    expect(await service.accounts()).toBe(1);
    await page.screenshot({ path: join(shots, "delete-account-2-signed-in.png") });

    // It asks first, with the phone's confirmation in the computer's words; Cancel sends nothing.
    await deleteAccount.click();
    const confirmation = settings.getByRole("alertdialog");
    await expect(confirmation).toContainText(text.settings.deleteWaveAccount.title);
    await expect(confirmation).toContainText(text.settings.deleteWaveAccount.message);
    await page.screenshot({ path: join(shots, "delete-account-3-confirmation.png") });
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toHaveCount(0);
    expect(await service.accounts()).toBe(1);

    // Another Google account: nothing is deleted, and Wave stays signed in.
    service.state.googleSubject = "google-sub-2";
    await deleteAccount.click();
    await confirmation.getByRole("button", { name: "Delete Account" }).click();
    await expect(page.getByTestId("account-note")).toHaveText(
      text.settings.googleDidntConfirmThisAccountPick,
    );
    await expect(page.getByTestId("account-name")).toContainText("Ana");
    expect(await service.accounts()).toBe(1);
    await page.screenshot({ path: join(shots, "delete-account-4-wrong-google-account.png") });

    // The service fails: it says so, and Wave stays signed in.
    service.state.googleSubject = "google-sub-1";
    service.state.down = true;
    await deleteAccount.click();
    await confirmation.getByRole("button", { name: "Delete Account" }).click();
    await expect(page.getByTestId("account-note")).toHaveText(
      text.settings.wavesServerDidntDeleteTheAccountTry,
    );
    await expect(page.getByTestId("account-name")).toContainText("Ana");
    expect(await service.accounts()).toBe(1);
    await page.screenshot({ path: join(shots, "delete-account-5-service-failed.png") });

    // It works: the account is gone from the service, Wave is signed out, the Library stays.
    // Once the request is with the service there is no Cancel, and the note says so.
    service.state.down = false;
    let answer = () => {};
    service.state.hold = new Promise((resolve) => (answer = resolve));
    await deleteAccount.click();
    await confirmation.getByRole("button", { name: "Delete Account" }).click();
    await expect(page.getByTestId("account-note")).toHaveText(text.desktopAccount.deletionSent);
    await expect(settings.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await page.screenshot({ path: join(shots, "delete-account-5b-on-its-way.png") });
    answer();
    await expect(settings.getByRole("button", { name: "Sign In with Google" })).toBeVisible();
    await expect(settings).toContainText(text.settings.yourWaveAccountWasDeletedEverythingOn);
    await expect(deleteAccount).toHaveCount(0);
    expect(await service.accounts()).toBe(0);
    await page.screenshot({ path: join(shots, "delete-account-6-deleted.png") });
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    await expect(page.getByTestId("song-count")).toHaveText(oneSong);
    expect(existsSync(song)).toBe(true);
    await page.screenshot({ path: join(shots, "delete-account-7-library-kept.png") });
  } finally {
    await app.close();
    service.close();
    rmSync(data, { recursive: true, force: true });
  }
});
