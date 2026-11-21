import assert from "node:assert/strict";
import { test } from "node:test";
import { addTrack, openTestDatabase, star } from "@wave/client/testing";
import { recordPlay } from "@wave/client/db/playHistory";
import { readHome } from "./home.ts";
import { sql } from "drizzle-orm";
import { parseHomeArrangement, storedHomeArrangement } from "@wave/core";

test("Home lists local shelves and counted rankings in the phone's order", async () => {
  const db = await openTestDatabase();
  const moon = addTrack(db, {
    title: "Pink Moon",
    album: "Pink Moon",
    artist: "Nick Drake",
    addedAt: 1000,
  });
  const road = addTrack(db, {
    title: "Road",
    album: "Pink Moon",
    artist: "Nick Drake",
    addedAt: 3000,
  });
  const harvest = addTrack(db, {
    title: "Harvest",
    album: "Harvest",
    artist: "Neil Young",
    addedAt: 2000,
  });
  for (const [trackId, startedAt, counted] of [
    [moon, 100, true],
    [moon, 200, true],
    [harvest, 300, true],
    [road, 400, false],
  ] as const)
    recordPlay(db, {
      trackId: String(trackId),
      startedAt,
      counted,
      listenedMs: counted ? 16000 : 1000,
      durationMs: 180000,
      endReason: "skipped",
      source: "desktop",
      context: { kind: "home", id: "most-played" },
    });
  star(db, harvest, 500);
  const home = readHome(db, null);
  assert.deepEqual(
    home.items.map((s) => s.id),
    [
      "new-releases",
      "upcoming-shows",
      "discover",
      "recently-added",
      "recently-played",
      "most-played",
      "most-played-albums",
      "most-played-artists",
      "favorites",
    ],
  );
  const rows = (id: string) => home.items.find((s) => s.id === id)!.rows.items;
  assert.deepEqual(
    rows("recently-added").map((r) => r.title),
    ["Pink Moon", "Harvest"],
  );
  assert.deepEqual(
    rows("recently-played").map((r) => r.title),
    ["Pink Moon", "Harvest"],
  );
  assert.deepEqual(
    rows("most-played").map((r) => [r.title, r.playCount]),
    [
      ["Pink Moon", 2],
      ["Harvest", 1],
    ],
  );
  assert.deepEqual(
    rows("most-played-albums").map((r) => [r.title, r.playCount]),
    [
      ["Pink Moon", 2],
      ["Harvest", 1],
    ],
  );
  assert.deepEqual(
    rows("most-played-artists").map((r) => [r.title, r.playCount]),
    [
      ["Nick Drake", 2],
      ["Neil Young", 1],
    ],
  );
  assert.deepEqual(
    rows("favorites").map((r) => r.title),
    ["Harvest"],
  );
});

test("Home keeps missing Library songs, bounds shelves and explains an empty or unplayed Library", async () => {
  const db = await openTestDatabase();
  assert.equal(readHome(db, null).hint, "empty");
  for (let i = 0; i < 15; i++) {
    const id = addTrack(db, { title: `Song ${i}`, addedAt: i + 1 });
    star(db, id, i + 1);
  }
  db.run(sql`UPDATE tracks SET path=NULL WHERE title='Song 14'`);
  const home = readHome(db, null);
  assert.equal(home.hint, "play");
  assert.equal(home.items.find((s) => s.id === "recently-added")?.rows.total, 12);
  const favorites = home.items.find((s) => s.id === "favorites")!.rows;
  assert.equal(favorites.total, 10);
  assert.equal(favorites.items[0]?.title, "Song 14");
  const stored = storedHomeArrangement({
    ...parseHomeArrangement(null),
    sections: ["favorites", "most-played", "recently-added"],
  });
  assert.deepEqual(
    readHome(db, stored).items.map((s) => s.id),
    ["favorites", "recently-added"],
  );
});

test("In your orbit follows Discover with the artists played in the last 14 days", async () => {
  const db = await openTestDatabase();
  const drake = addTrack(db, { title: "Road", album: "Pink Moon", artist: "Nick Drake" });
  const young = addTrack(db, { title: "Harvest", album: "Harvest", artist: "Neil Young" });
  const old = addTrack(db, { title: "Blue", album: "Blue", artist: "Joni Mitchell" });
  const day = 86_400_000;
  const now = Date.now();
  for (const [trackId, startedAt] of [
    [young, now - day],
    [young, now - 2 * day],
    [drake, now - 13 * day],
    [old, now - 15 * day],
    [old, now - 16 * day],
    [old, now - 17 * day],
  ] as const)
    recordPlay(db, {
      trackId: String(trackId),
      startedAt,
      counted: true,
      listenedMs: 180000,
      durationMs: 180000,
      endReason: "completed",
      source: "desktop",
      context: null,
    });
  const home = readHome(db, null);
  const ids = home.items.map((s) => s.id);
  assert.equal(ids[ids.indexOf("discover") + 1], "in-your-orbit");
  const orbit = home.items.find((s) => s.id === "in-your-orbit")!;
  assert.equal(orbit.kind, "artist");
  assert.deepEqual(
    orbit.rows.items.map((r) => r.title),
    ["Neil Young", "Nick Drake"],
  );
  assert.equal(
    home.items.find((s) => s.id === "most-played-artists")!.rows.items[0]?.title,
    "Joni Mitchell",
  );
});

test("In your orbit holds ten Library artists though online artists were played more", async () => {
  const db = await openTestDatabase();
  const now = Date.now();
  for (let i = 0; i < 12; i++) {
    recordPlay(
      db,
      {
        trackId: `yt:online-${i}`,
        startedAt: now - i,
        listenedMs: 60_000,
        durationMs: 180_000,
        endReason: "completed",
        counted: true,
        source: "desktop",
        context: null,
      },
      false,
      {
        videoId: `online-${i}`,
        title: `Online ${i}`,
        artists: [`Online artist ${i}`],
        album: null,
        durationMs: 180_000,
        artworkUrl: null,
        explicit: false,
        albumId: null,
      },
    );
  }
  const expected: string[] = [];
  for (let i = 0; i < 10; i++) {
    const id = addTrack(db, { title: `Local ${i}`, artist: `Local artist ${i}` });
    expected.push(`Local artist ${i}`);
    recordPlay(db, {
      trackId: String(id),
      startedAt: now - 100 - i,
      listenedMs: 60_000,
      durationMs: 180_000,
      endReason: "completed",
      counted: true,
      source: "desktop",
      context: null,
    });
  }
  const home = readHome(db, null);
  assert.deepEqual(
    home.items
      .find((section) => section.id === "in-your-orbit")
      ?.rows.items.map((row) => row.title),
    expected,
  );
});
