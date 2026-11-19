import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { saveFollow } from "@wave/client/db/follows";
import { saveFollowShows } from "@wave/client/db/followShows";
import { databaseFollowStore } from "@wave/client/follows/followStore";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import type { FollowRelease } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

const appFolder = join(import.meta.dirname, "..");
const DAY = 86_400_000;
/** A local day, as the release line counts them. */
const day = (ago: number) => {
  const date = new Date(Date.now() - ago * DAY);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
};

const release = (key: string, title: string, over: Partial<FollowRelease> = {}): FollowRelease => ({
  key,
  artistKey: "abba",
  title,
  type: "album",
  releaseDate: day(1),
  artworkUrl: null,
  explicit: false,
  browseId: null,
  videoIds: [],
  recordingKeys: [],
  ...over,
});

test("Home shows followed artists' new releases and shows, and neither section with nothing to show", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-home-follow-"));
  const launch = () =>
    electron.launch({
      args: [appFolder, "--lang=en-US"],
      env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
    });
  const seed = (fill: (db: TestDatabase) => Effect.Effect<void>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* fill((yield* Database) as unknown as TestDatabase);
      }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
    );
  try {
    await seed((db) =>
      Effect.sync(() => {
        addTrack(db, { title: "Waterloo", album: "Waterloo", artist: "ABBA", durationMs: 180000 });
        db.run(sql`INSERT INTO desktop_settings(key,value) VALUES('settings.ytMusic','off')`);
      }),
    );

    // Nobody followed: Home has neither section.
    let app = await launch();
    let country: string;
    try {
      const page = await app.firstWindow();
      const home = page.getByTestId("home");
      await expect(home.locator('[data-section="recently-added"]')).toBeVisible();
      await expect(home.locator('[data-section="new-releases"]')).toHaveCount(0);
      await expect(home.locator('[data-section="upcoming-shows"]')).toHaveCount(0);
      country = await app.evaluate(({ app }) => app.getLocaleCountryCode());
    } finally {
      await app.close();
    }

    await seed((db) =>
      Effect.gen(function* () {
        saveFollow(db, { name: "ABBA" }, "shows", Date.now());
        yield* Effect.orDie(
          databaseFollowStore(db).saveFollowReleases(
            "abba",
            [
              release("deezer:1", "Voyage", { type: "ep", releaseDate: day(0) }),
              release("deezer:2", "Waterloo", { releaseDate: day(3) }),
            ],
            Date.now(),
          ),
        );
        const show = { artistKey: "abba", country, venue: "Arena" };
        saveFollowShows(db, {
          key: "abba",
          attractionId: "K1",
          country,
          checkedAt: Date.now(),
          shows: [
            {
              ...show,
              id: "E1",
              startsAt: "2099-05-01T20:00:00Z",
              city: "Recife",
              ticketUrl: "https://tickets.example/E1",
            },
          ],
        });
      }),
    );

    app = await launch();
    try {
      const page = await app.firstWindow();
      await page.bringToFront();
      const home = page.getByTestId("home");
      const releases = home.locator('[data-section="new-releases"]');
      const shows = home.locator('[data-section="upcoming-shows"]');
      await expect(releases.locator("h2")).toHaveText("New from Artists You Follow");
      await expect(shows.locator("h2")).toHaveText("Upcoming Shows");
      await expect(home.locator("h2").first()).toHaveText("New from Artists You Follow");
      await expect(releases.getByRole("button")).toHaveText([
        /EP.*Voyage.*ABBA.*Today/,
        /Waterloo/,
      ]);
      const ticket = shows.getByRole("link", {
        name: /ABBA.*Recife · Arena. Opens the ticket page/,
      });
      await expect(ticket).toHaveAttribute("href", "https://tickets.example/E1");
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.screenshot({
          path: join(appFolder, "test-results", `home-follow-${process.platform}-${theme}.png`),
        });
      }

      // YT Music is off: a release the Library lacks says so, one it has opens its album.
      await releases.getByRole("button", { name: /Voyage/ }).click();
      await expect(page.getByText("YT Music is off in Settings")).toBeVisible();
      await releases.getByRole("button", { name: /Waterloo/ }).click();
      await expect(page.getByTestId("hero")).toContainText("Waterloo");
    } finally {
      await app.close();
    }

    // Followed artists switched off on the account: both sections go.
    await seed((db) =>
      Effect.sync(() => {
        db.run(
          sql`INSERT INTO desktop_synced_preferences(key,value) VALUES('settings.followedArtists','off')`,
        );
      }),
    );
    app = await launch();
    try {
      const home = (await app.firstWindow()).getByTestId("home");
      await expect(home.locator('[data-section="recently-added"]')).toBeVisible();
      await expect(home.locator('[data-section="new-releases"]')).toHaveCount(0);
      await expect(home.locator('[data-section="upcoming-shows"]')).toHaveCount(0);
    } finally {
      await app.close();
    }
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

test("a check that failed is asked again, and one that ends after a return to Home still shows what it saved", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-home-follow-check-"));
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const home = page.getByTestId("home");
    await expect(home).toBeVisible();
    // Main's own handlers are replaced: checks fail until the test lets them run, then wait to
    // be let go, and the cards exist only once one has saved them.
    const state = await app.evaluateHandle(({ ipcMain }, releaseDate) => {
      const state = { checks: 0, failing: true, saved: false, finish: () => {} };
      ipcMain.removeHandler("home.follow");
      ipcMain.handle("home.follow", () => ({
        releases: state.saved
          ? [
              {
                key: "k",
                title: "Voyage",
                artist: "ABBA",
                type: "album",
                releaseDate,
                hasArtwork: false,
              },
            ]
          : [],
        shows: [],
      }));
      ipcMain.removeHandler("home.followCheck");
      ipcMain.handle("home.followCheck", () => {
        state.checks += 1;
        if (state.failing) throw new Error("No connection");
        return new Promise<boolean>((resolve) => {
          state.finish = () => {
            state.saved = true;
            resolve(true);
          };
        });
      });
      return state;
    }, day(1));
    const checks = () => state.evaluate((held) => held.checks);
    const visit = async () => {
      await page.locator(".sidebar").getByRole("button", { name: "Songs", exact: true }).click();
      await expect(home).toHaveCount(0);
      await page.locator(".sidebar").getByRole("button", { name: "Home", exact: true }).click();
      await expect(home).toBeVisible();
    };
    await page.reload();
    await expect(home).toBeVisible();
    await expect.poll(checks).toBeGreaterThanOrEqual(1);

    // The next visit asks again; the check it starts then runs until it's let go.
    await state.evaluate((held) => {
      held.failing = false;
    });
    const failed = await checks();
    await visit();
    await expect.poll(checks).toBeGreaterThan(failed);
    const running = await checks();
    await visit();
    await state.evaluate((held) => held.finish());
    await expect(home.locator('[data-section="new-releases"]')).toContainText("Voyage");
    expect(await checks()).toBe(running);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
