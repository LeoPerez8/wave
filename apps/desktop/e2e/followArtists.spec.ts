import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { saveFollow, selectFollows } from "@wave/client/db/follows";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

/**
 * Following artists in the built app (#1200): the Follow button and its level card on a Library
 * artist's page and on a YT Music artist's page, and Settings › Followed artists with its list,
 * Unfollow and Undo, the search's lines, and the switch. Deezer and YouTube Music are answered by
 * handlers the test puts in main's place, so nothing here asks the network.
 */
const appFolder = join(import.meta.dirname, "..");

const withDatabase = <A>(data: string, use: (db: TestDatabase) => A) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return use((yield* Database) as unknown as TestDatabase);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );

test("an artist is followed from their page, and Settings lists, unfollows, restores and finds artists", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-follow-"));
  await withDatabase(data, (db) => {
    addTrack(db, { title: "Waterloo", album: "Waterloo", artist: "ABBA", durationMs: 180000 });
    // Followed on a phone, from their YT Music page.
    saveFollow(db, { name: "Zedd", ytBrowseId: "UCzeddzeddzeddzeddzeddze" }, "releases", 1);
  });
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("home")).toBeVisible();
    await app.evaluate(({ ipcMain }) => {
      // Deezer, by what is searched: an artist, no artists, or no answer.
      ipcMain.removeHandler("follows.search");
      ipcMain.handle("follows.search", (_event, query: string) =>
        query === "moby"
          ? {
              answered: true,
              results: [{ key: "moby", name: "Moby", level: null, artistId: null, deezerId: 12 }],
            }
          : { answered: query !== "offline", results: [] },
      );
      ipcMain.removeHandler("yt.artist");
      ipcMain.handle("yt.artist", () => ({
        status: "ok",
        page: {
          name: "Zedd",
          artworkUrl: null,
          songs: { items: [], total: 0 },
          albums: [],
          singles: [],
          similar: [],
        },
      }));
    });
    const sidebar = page.locator(".sidebar");
    const hero = page.getByTestId("hero");
    const follow = page.getByTestId("follow-button");
    const openSettings = async () => {
      await sidebar.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .locator(".settings-page > nav")
        .getByRole("button", { name: "Followed artists", exact: true })
        .click();
    };

    // A Library artist's page: Follow, the card's level, then Following.
    await sidebar.getByRole("button", { name: "Artists", exact: true }).click();
    await page.getByRole("row", { name: /ABBA/ }).dblclick();
    await expect(hero.locator("h1")).toHaveText("ABBA");
    await expect(follow).toHaveText("Follow");
    await expect(follow).toHaveAccessibleName("ABBA, Follow");
    await follow.click();
    const card = page.getByRole("dialog", { name: "Follow ABBA" });
    await expect(card.getByRole("radio")).toHaveCount(1);
    await expect(card.getByRole("button", { name: "Unfollow" })).toHaveCount(0);
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({
        path: join(appFolder, "test-results", `follow-card-${process.platform}-${theme}.png`),
      });
    }
    await card.getByRole("radio", { name: "New music", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(follow).toHaveText("Following");
    await expect(follow).toHaveAccessibleName("ABBA, Following, New music");
    await expect(follow).toBeFocused();
    // Esc closes the card and changes nothing.
    await follow.click();
    await expect(card.getByRole("radio", { name: "New music", exact: true })).toBeChecked();
    await expect(card.getByRole("button", { name: "Unfollow" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(follow).toHaveText("Following");

    // Settings: the artists followed, A to Z, each with its level and Unfollow.
    await openSettings();
    const settings = page.getByTestId("followed-artists-settings");
    const rows = settings.getByTestId("followed-artists").getByRole("listitem");
    await expect(settings.getByRole("switch", { name: "Followed artists" })).toBeChecked();
    await expect(rows).toHaveText([/ABBA/, /Zedd/]);
    await expect(settings.getByRole("combobox", { name: "Follow ABBA" })).toHaveValue("releases");
    await expect(rows.nth(0).getByRole("button", { name: "Unfollow, ABBA" })).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({
        path: join(appFolder, "test-results", `followed-artists-${process.platform}-${theme}.png`),
      });
    }

    // Unfollow removes the artist; Undo on the toast brings the follow back with its level.
    await rows.nth(0).getByRole("button", { name: "Unfollow, ABBA" }).click();
    await expect(rows).toHaveText([/Zedd/]);
    await expect(page.getByText("Unfollowed ABBA")).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(rows).toHaveText([/ABBA/, /Zedd/]);
    await expect(settings.getByRole("combobox", { name: "Follow ABBA" })).toHaveValue("releases");

    // The search: no matches and no answer read differently, and a found artist is followed.
    const search = settings.getByRole("searchbox", { name: "Find artists to follow" });
    await search.fill("nobody");
    await expect(settings.getByRole("status")).toHaveText("No artists found.");
    await search.fill("offline");
    await expect(settings.getByRole("status")).toHaveText(
      "Couldn't reach Deezer. Library results are still available.",
    );
    await search.fill("moby");
    const results = settings.getByTestId("follow-search-results").getByRole("listitem");
    await expect(results).toHaveText([/Moby/]);
    await expect(settings.getByRole("status")).toHaveCount(0);
    await settings.getByRole("combobox", { name: "Follow Moby" }).selectOption("releases");
    await search.fill("");
    await expect(rows).toHaveText([/ABBA/, /Moby/, /Zedd/]);

    // A YT Music artist's page has the button too, with the follow the account holds.
    await rows.nth(2).getByRole("button", { name: "Zedd" }).first().click();
    await expect(page.getByTestId("yt-artist").locator("h1")).toHaveText("Zedd");
    await expect(follow).toHaveText("Following");
    await follow.click();
    await page.getByRole("dialog", { name: "Follow Zedd" }).getByRole("button").click();
    await expect(follow).toHaveText("Follow");
    await follow.click();
    await page.getByRole("dialog", { name: "Follow Zedd" }).getByRole("radio").click();
    await expect(follow).toHaveText("Following");

    // The switch off: the lists stay, and no artist page has a Follow button.
    await openSettings();
    await settings.getByRole("switch", { name: "Followed artists" }).uncheck();
    await expect(search).toBeDisabled();
    await expect(settings.getByRole("combobox", { name: "Follow ABBA" })).toBeDisabled();
    await sidebar.getByRole("button", { name: "Artists", exact: true }).click();
    await page.getByRole("row", { name: /ABBA/ }).dblclick();
    await expect(hero.locator("h1")).toHaveText("ABBA");
    await expect(hero.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await expect(follow).toHaveCount(0);
  } finally {
    await app.close();
  }
  try {
    // What the window did is in the Library, as the account syncs it.
    const follows = await withDatabase(data, (db) => selectFollows(db));
    expect(follows.map((row) => [row.name, row.level])).toEqual([
      ["ABBA", "releases"],
      ["Moby", "releases"],
      ["Zedd", "releases"],
    ]);
    expect(follows[1]?.deezerId).toBe(12);
    expect(follows[2]?.ytBrowseId).toBe("UCzeddzeddzeddzeddzeddze");
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test("signed in to a Wave account, the card offers shows too and Settings has the country for them", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-follow-shows-"));
  await withDatabase(data, (db) => {
    addTrack(db, { title: "Waterloo", album: "Waterloo", artist: "ABBA", durationMs: 180000 });
  });
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("home")).toBeVisible();
    // This build has no sync service to sign in to: main's answers are given as a signed-in
    // build gives them, and what the window asks for is kept.
    const asked = await app.evaluateHandle(({ ipcMain }) => {
      const held = { level: null as string | null, country: null as string | null };
      const levels = () => ({
        enabled: true,
        showsAvailable: true,
        signInForShows: false,
        country: held.country ?? "BR",
      });
      const state = () => ({ ...levels(), level: held.level });
      const view = () => ({
        ...levels(),
        showsConfigured: true,
        countryChoice: held.country,
        follows:
          held.level === null
            ? []
            : [{ key: "abba", name: "ABBA", level: held.level, artistId: null, ytBrowseId: null }],
      });
      for (const call of ["state", "set", "view", "setCountry"])
        ipcMain.removeHandler(`follows.${call}`);
      ipcMain.handle("follows.state", state);
      ipcMain.handle("follows.set", (_event, _target: unknown, level: string | null) => {
        held.level = level;
        return state();
      });
      ipcMain.handle("follows.view", view);
      ipcMain.handle("follows.setCountry", (_event, country: string | null) => {
        held.country = country;
        return view();
      });
      return held;
    });
    const sidebar = page.locator(".sidebar");
    await sidebar.getByRole("button", { name: "Artists", exact: true }).click();
    await page.getByRole("row", { name: /ABBA/ }).dblclick();
    const follow = page.getByTestId("follow-button");
    await follow.click();
    const card = page.getByRole("dialog", { name: "Follow ABBA" });
    await expect(card.getByRole("radio")).toHaveCount(2);
    await page.screenshot({
      path: join(appFolder, "test-results", `follow-card-shows-${process.platform}.png`),
    });
    await card.getByRole("radio", { name: "New music and shows", exact: true }).click();
    await expect(follow).toHaveAccessibleName("ABBA, Following, New music and shows");
    expect(await asked.evaluate((held) => held.level)).toBe("shows");

    await sidebar.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .locator(".settings-page > nav")
      .getByRole("button", { name: "Followed artists", exact: true })
      .click();
    const settings = page.getByTestId("followed-artists-settings");
    await expect(settings.getByRole("combobox", { name: "Follow ABBA" })).toHaveValue("shows");
    const country = settings.getByRole("combobox", { name: "Country" });
    await expect(country.locator("option:checked")).toHaveText("This computer's region");
    await country.selectOption({ label: "Portugal" });
    await expect(country).toHaveValue("PT");
    expect(await asked.evaluate((held) => held.country)).toBe("PT");
    await settings.getByRole("combobox", { name: "Follow ABBA" }).selectOption("releases");
    await expect(settings.getByRole("combobox", { name: "Follow ABBA" })).toHaveValue("releases");
    await page.screenshot({
      path: join(appFolder, "test-results", `followed-artists-shows-${process.platform}.png`),
    });
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
