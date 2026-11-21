import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, star, type TestDatabase } from "@wave/client/testing";
import { recordPlay } from "@wave/client/db/playHistory";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

const appFolder = join(import.meta.dirname, "..");
const shots = join(appFolder, "test-results");
const hiddenSections = [
  "New from Artists You Follow",
  "Upcoming Shows",
  "Discover",
  "In your orbit",
  "From your library",
  "Community playlists",
];

/** Presses Tab until the focused button is [name], as someone without a mouse would. */
const tabTo = async (page: Page, name: string) => {
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  for (let presses = 0; presses < 60 && (await focused()) !== name; presses++)
    await page.keyboard.press("Tab");
  expect(await focused()).toBe(name);
};

test("Home's editor reorders, removes and adds sections from Home and Settings, by keyboard and by dragging", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-home-editor-"));
  mkdirSync(shots, { recursive: true });
  const database = libraryLayer(join(data, "wave.db"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (const [i, title, album, artist] of [
        [0, "Pink Moon", "Pink Moon", "Nick Drake"],
        [1, "Harvest", "Harvest", "Neil Young"],
        [2, "Blue", "Blue", "Joni Mitchell"],
      ] as const) {
        const id = addTrack(db, { title, album, artist, addedAt: i * 1000, durationMs: 180000 });
        star(db, id, i * 1000);
        recordPlay(db, {
          trackId: String(id),
          startedAt: 10000 + i,
          counted: true,
          listenedMs: 180000,
          durationMs: 180000,
          endReason: "completed",
          source: "desktop",
          context: null,
        });
      }
      db.run(sql`INSERT INTO desktop_settings(key,value) VALUES('settings.ytMusic','off')`);
      // The account's arrangement, from a phone that has a section this Wave doesn't draw.
      const stored = JSON.stringify({
        shown: [
          "recently-added",
          "karaoke",
          "recently-played",
          "most-played",
          "most-played-albums",
          "most-played-artists",
          "favorites",
          "stats",
        ],
        hidden: [
          "new-releases",
          "upcoming-shows",
          "discover",
          "in-your-orbit",
          "from-your-library",
          "community-playlists",
        ],
      });
      db.run(
        sql`INSERT INTO desktop_synced_preferences(key,value) VALUES('settings.homeArrangement',${stored})`,
      );
    }).pipe(Effect.provide(database)),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await page.bringToFront();
    const home = page.getByTestId("home");
    const headings = home.locator("h2:not(#home-editor-title)");
    await expect(headings).toHaveText(
      [
        "Recently added",
        "Recently played",
        "Most played",
        "Most played albums",
        "Most played artists",
        "Favorites",
        "Stats",
      ],
      // The window's first draw, which a busy machine delays.
      { timeout: 30_000 },
    );

    // From Home, with the keyboard alone: the dialog opens with Done focused.
    const editButton = home.getByRole("button", { name: "Edit Home", exact: true });
    await editButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Edit Home" });
    await expect(dialog.getByRole("button", { name: "Done" })).toBeFocused();
    const shown = dialog.locator('[data-list="shown"] > li > .home-editor-line');
    const hidden = dialog.locator('[data-list="hidden"] > li');
    await expect(shown).toHaveText([
      "Recently added",
      "Recently played",
      "Most played",
      "Most played albums",
      "Most played artists",
      "Favorites",
      "Stats",
    ]);
    await expect(hidden).toHaveText(hiddenSections);

    // Move Up keeps the focus on its button, so Enter repeats it; Home follows behind the dialog.
    await tabTo(page, "Move up: Favorites");
    for (let presses = 0; presses < 5; presses++) await page.keyboard.press("Enter");
    await expect(headings.first()).toHaveText("Favorites");
    await expect(dialog.getByRole("button", { name: "Move up: Favorites" })).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Move up: Favorites" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.keyboard.press("Enter");
    await expect(shown.first()).toHaveText("Favorites");

    // Remove hands the focus to the next row; Add hands it to the row it made.
    await tabTo(page, "Remove Stats from Home");
    await page.keyboard.press("Enter");
    await expect(headings).toHaveCount(6);
    await expect(hidden).toHaveText([...hiddenSections, "Stats"]);
    await expect(
      dialog.getByRole("button", { name: "Remove Most played artists from Home" }),
    ).toBeFocused();
    await tabTo(page, "Add Stats to Home");
    await page.keyboard.press("Enter");
    await expect(headings.last()).toHaveText("Stats");
    await expect(dialog.getByRole("button", { name: "Remove Stats from Home" })).toBeFocused();

    // Discover's rows sit under Discover once it is on Home; the last one can't be removed.
    await tabTo(page, "Add Discover to Home");
    await page.keyboard.press("Enter");
    const rows = dialog.getByRole("list", { name: "Discover" });
    await expect(rows.locator("li")).toHaveText(["Magic Queue", "Artist mixes", "Genre mixes"]);
    await rows.getByRole("button", { name: "Remove Genre mixes from Discover" }).click();
    await rows.getByRole("button", { name: "Remove Artist mixes from Discover" }).click();
    await expect(
      rows.getByRole("button", { name: "Remove Magic Queue from Discover" }),
    ).toHaveAttribute("aria-disabled", "true");
    await rows.getByRole("button", { name: "Add Genre mixes to Discover" }).click();
    await expect(rows.locator("li").first()).toHaveText("Magic Queue");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: join(shots, `home-editor-${process.platform}-dark.png`) });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: join(shots, `home-editor-${process.platform}-light.png`) });
    await dialog.getByRole("button", { name: "Remove Discover from Home" }).click();

    // Dragging a row drops it at the row it is released on.
    await shown
      .filter({ hasText: /^Most played$/ })
      .dragTo(shown.filter({ hasText: "Recently added" }));
    await expect(shown).toHaveText([
      "Favorites",
      "Most played",
      "Recently added",
      "Recently played",
      "Most played albums",
      "Most played artists",
      "Stats",
    ]);
    await expect(headings).toHaveText([
      "Favorites",
      "Most played",
      "Recently added",
      "Recently played",
      "Most played albums",
      "Most played artists",
      "Stats",
    ]);

    // Esc closes the dialog and gives the focus back to Edit Home.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(editButton).toBeFocused();

    // The same editor under Settings; Home shows the change when it is opened again.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .locator(".settings-page nav")
      .getByRole("button", { name: "Home", exact: true })
      .click();
    const settings = page.locator(".settings-body");
    await expect(settings.getByRole("heading", { name: "Edit Home" })).toBeVisible();
    await settings.getByRole("button", { name: "Remove Recently played from Home" }).click();
    await expect(settings.locator('[data-list="hidden"] > li').last()).toHaveText(
      "Recently played",
    );
    await page.screenshot({ path: join(shots, `home-editor-${process.platform}-settings.png`) });
    await page.getByRole("button", { name: "Home", exact: true }).first().click();
    await expect(page.getByTestId("home").locator("h2")).toHaveText([
      "Favorites",
      "Most played",
      "Recently added",
      "Most played albums",
      "Most played artists",
      "Stats",
    ]);
  } finally {
    await app.close();
  }
  // The section this Wave doesn't draw is still in the arrangement, after the one it followed.
  const kept = await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      return db.get<{ value: string }>(
        sql`SELECT value FROM desktop_synced_preferences WHERE key = 'settings.homeArrangement'`,
      );
    }).pipe(Effect.provide(database)),
  );
  expect((JSON.parse(kept!.value) as { shown: string[] }).shown).toEqual([
    "favorites",
    "most-played",
    "recently-added",
    "karaoke",
    "most-played-albums",
    "most-played-artists",
    "stats",
  ]);
  rmSync(data, { recursive: true, force: true });
});
