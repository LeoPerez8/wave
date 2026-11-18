import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const appFolder = join(import.meta.dirname, "..");

test("after the first scan Wave invites to sign in once, and Settings › Accounts has Sign In", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-account-"));
  mkdirSync(join(data, "Music"));
  // An unpackaged run may name a service; nothing here goes to it unless Sign In is clicked.
  const env = {
    ...process.env,
    WAVE_DATA_DIR: data,
    WAVE_MUSIC_DIR: join(data, "Music"),
    WAVE_SYNC_URL: "http://127.0.0.1:9",
    WAVE_GOOGLE_DESKTOP_CLIENT_ID: "e2e-client",
  };
  let app = await electron.launch({ args: [appFolder, "--lang=en-US"], env });
  try {
    let page = await app.firstWindow();
    const invitation = page.getByTestId("invitation");
    await expect(invitation).toBeVisible();
    await invitation.getByRole("button", { name: "Not Now" }).click();
    await expect(invitation).toBeHidden();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Accounts", exact: true }).click();
    const settings = page.getByTestId("account-settings");
    await expect(settings.getByRole("button", { name: "Sign In with Google" })).toBeVisible();
    await expect(settings).toContainText("Audio and file paths never do.");
    // YouTube's own Sign In sits under Use YT Music; nothing opens unless it is clicked.
    const youtube = page.getByTestId("yt-account-settings");
    await expect(youtube.getByRole("button", { name: "Sign In", exact: true })).toBeVisible();
    await expect(youtube).toContainText("The session stays on this computer.");
    await app.close();
    app = await electron.launch({ args: [appFolder, "--lang=en-US"], env });
    page = await app.firstWindow();
    await expect(page.getByTestId("song-count")).toBeVisible();
    await expect(page.getByTestId("invitation")).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
