import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Database } from "@wave/client";
import { creditSplits } from "@wave/client/db/credits";
import type { LibraryDatabase } from "@wave/client/db/database";
import { listeningHistory } from "@wave/client/db/listeningHistory";
import { endPlay, recordPlay } from "@wave/client/db/playHistory";
import { createPlaylist } from "@wave/client/db/playlists";
import { countedListening } from "@wave/client/db/stats";
import { stampPreference } from "@wave/client/db/sync";
import { syncCycle, type SyncTransport } from "@wave/client/sync/syncCycle";
import { addTrack, openTestDatabase, star, type TestDatabase } from "@wave/client/testing";
import { DESKTOP_SYNC_PERIOD_MS, type PlayEvent } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { fakeClock } from "../../../../../packages/core/src/testSyncClock.ts";
import { pullAll } from "../../../../sync/src/testing.ts";
import { libraryLayer } from "../database.ts";
import { browseLibrary } from "../library/browse.ts";
import { desktop } from "../account/testAccount.ts";
import { createDesktopSync, syncedPreference } from "./desktopSync.ts";

/** The desktop's own Library file, opened as Wave opens it. */
const desktopLibrary = async (): Promise<TestDatabase> => {
  const folder = mkdtempSync(join(tmpdir(), "wave-desktop-sync-"));
  const runtime = ManagedRuntime.make(libraryLayer(join(folder, "wave.db")));
  after(async () => {
    await runtime.dispose();
    rmSync(folder, { recursive: true, force: true });
  });
  return (await runtime.runPromise(
    Effect.gen(function* () {
      return yield* Database;
    }),
  )) as unknown as TestDatabase;
};

const OK_COMPUTER = { artist: "Radiohead", album: "OK Computer" };

const deviceId = (db: LibraryDatabase): string =>
  db.get<{ id: string }>(sql`SELECT phone_id AS id FROM phone`)!.id;

/** A phone on the same account, syncing as the phone app does. */
const phoneOn = async (transport: SyncTransport) => {
  const db = await openTestDatabase();
  const values = new Map<string, string>();
  const sync = () =>
    syncCycle({
      db,
      splits: creditSplits(),
      transport,
      account: "ana@example.com",
      preferences: {
        value: (key) => values.get(key) ?? null,
        apply: (key, value) => void (value === null ? values.delete(key) : values.set(key, value)),
      },
      now: Date.now,
      songsChanged: true,
      wait: async () => {},
    });
  /** Changes a synced setting, as the phone's Settings does. */
  const set = (key: string, value: string) => {
    values.set(key, value);
    stampPreference(db, key, Date.now());
  };
  return { db, sync, set };
};

/** The desktop app (its Library, account and sync) and a phone on the same account. */
const desktopApp = async (deps: { readonly starsPulled?: () => void } = {}) => {
  const app = await desktop();
  const signedIn = app.open();
  let requests = 0;
  const account = {
    ...signedIn,
    request: (...args: Parameters<typeof signedIn.request>) => {
      requests++;
      return signedIn.request(...args);
    },
  };
  const db = await desktopLibrary();
  const { clock, pass } = fakeClock();
  const sync = createDesktopSync({
    db,
    account,
    clock,
    focused: () => true,
    wait: async () => {},
    ...deps,
  });
  after(() => sync.dispose());
  const phoneSession = await app.service.signIn();
  const phone = await phoneOn({
    request: async (method, path, body) => {
      const response = await app.service.request(method, path, {
        session: phoneSession,
        ...(body === null ? {} : { body, headers: { "content-type": "application/json" } }),
      });
      return { status: response.status, body: await response.text() };
    },
  });
  return {
    service: app.service,
    account,
    db,
    sync,
    phone,
    phoneSession,
    pass,
    requests: () => requests,
  };
};

const playlistSongs = (db: LibraryDatabase, name: string) => {
  const playlist = browseLibrary(db, { kind: "playlists" }, 0, 50).items.find(
    (row) => row.title === name,
  );
  assert.ok(playlist, `no playlist ${name}`);
  return browseLibrary(db, { kind: "playlist", id: playlist.id }, 0, 50).items.map((row) => ({
    title: row.title,
    missing: row.path === null,
  }));
};

const playlistCount = (db: LibraryDatabase) =>
  browseLibrary(db, { kind: "playlists" }, 0, 50).total;

test("a phone's playlist shows on the desktop, its songs matched by recording key or missing", async () => {
  const desktop = await desktopApp();
  addTrack(desktop.db, { title: "Airbag", ...OK_COMPUTER });
  const { phone } = desktop;
  const airbag = addTrack(phone.db, { title: "Airbag", ...OK_COMPUTER });
  const lucky = addTrack(phone.db, { title: "Lucky", ...OK_COMPUTER });
  createPlaylist(
    phone.db,
    "Drive",
    [
      { source: "library", trackId: airbag },
      { source: "library", trackId: lucky },
    ],
    Date.now(),
  );
  phone.set("settings.theme", '{"light":"white"}');
  phone.set("settings.tabBar", '["home","library"]');
  await phone.sync();

  desktop.sync.start();
  const revision = desktop.sync.revision();
  await desktop.account.signIn();
  await desktop.sync.idle();

  assert.deepEqual(playlistSongs(desktop.db, "Drive"), [
    { title: "Airbag", missing: false },
    { title: "Lucky", missing: true },
  ]);
  assert.ok(desktop.sync.revision() > revision, "the window reads its lists again");
  // Account-wide settings apply on the desktop; the phone's own UI ones don't.
  assert.equal(syncedPreference(desktop.db, "settings.theme"), '{"light":"white"}');
  assert.equal(syncedPreference(desktop.db, "settings.tabBar"), null);
});

test("a star pulled from the account tells the desktop, so a missing song's star can download", async () => {
  let told = 0;
  const desktop = await desktopApp({ starsPulled: () => void told++ });
  const { phone } = desktop;
  star(phone.db, addTrack(phone.db, { title: "Lucky", ...OK_COMPUTER }), Date.now());
  await phone.sync();
  desktop.sync.start();
  await desktop.account.signIn();
  await desktop.sync.idle();
  assert.ok(told > 0, "a pull with stars tells");
});

test("a play on the desktop goes up with source desktop and shows in the phone's history and stats", async () => {
  const desktop = await desktopApp();
  const track = addTrack(desktop.db, { title: "Airbag", ...OK_COMPUTER });
  desktop.sync.start();
  await desktop.account.signIn();
  await desktop.sync.idle();

  const play: PlayEvent = {
    trackId: String(track),
    startedAt: Date.UTC(2026, 10, 18, 20),
    listenedMs: 200_000,
    durationMs: 284_000,
    counted: true,
    endReason: "completed",
    context: null,
    source: "desktop",
  };
  endPlay(desktop.db, recordPlay(desktop.db, play), play);
  desktop.sync.played("ended");
  createPlaylist(desktop.db, "Desk", [{ source: "library", trackId: track }], Date.now());
  desktop.sync.edited({ songs: false });
  await desktop.pass(10_000);
  await desktop.sync.idle();

  const plays = (await pullAll(desktop.service, desktop.phoneSession)).plays;
  assert.equal(plays.length, 1);
  assert.equal(plays[0]?.["source"], "desktop");
  await desktop.phone.sync();
  // The desktop is a device of its own on the account.
  assert.notEqual(deviceId(desktop.db), deviceId(desktop.phone.db));
  assert.deepEqual(
    desktop.phone.db.all<{ id: string }>(sql`SELECT phone_id AS id FROM playlists`),
    [{ id: deviceId(desktop.db) }],
  );
  const history = listeningHistory(desktop.phone.db).rows;
  assert.deepEqual(
    history.map((row) => row.snapshot.title),
    ["Airbag"],
  );
  assert.equal(
    countedListening(desktop.phone.db).reduce((sum, row) => sum + row.listenedMs, 0),
    200_000,
  );
});

test("the desktop pulls every 15 minutes, and on focus once 5 minutes passed", async () => {
  const desktop = await desktopApp();
  desktop.sync.start();
  await desktop.account.signIn();
  await desktop.sync.idle();
  const { phone } = desktop;
  const airbag = addTrack(phone.db, { title: "Airbag", ...OK_COMPUTER });
  createPlaylist(phone.db, "Drive", [{ source: "library", trackId: airbag }], Date.now());
  await phone.sync();

  desktop.sync.foreground();
  await desktop.sync.idle();
  assert.equal(playlistCount(desktop.db), 0, "focus right after a sync pulls nothing");

  await desktop.pass(DESKTOP_SYNC_PERIOD_MS);
  await desktop.sync.idle();
  assert.equal(playlistCount(desktop.db), 1);

  createPlaylist(phone.db, "Night", [{ source: "library", trackId: airbag }], Date.now());
  await phone.sync();
  await desktop.pass(5 * 60_000);
  desktop.sync.foreground();
  await desktop.sync.idle();
  assert.equal(playlistCount(desktop.db), 2);
});

test("signing out leaves the account: its missing songs go, the desktop's files stay", async () => {
  const desktop = await desktopApp();
  addTrack(desktop.db, { title: "Airbag", ...OK_COMPUTER });
  const lucky = addTrack(desktop.phone.db, { title: "Lucky", ...OK_COMPUTER });
  createPlaylist(desktop.phone.db, "Drive", [{ source: "library", trackId: lucky }], Date.now());
  await desktop.phone.sync();
  desktop.sync.start();
  await desktop.account.signIn();
  await desktop.sync.idle();
  assert.equal(browseLibrary(desktop.db, { kind: "songs" }, 0, 50).total, 2);

  const revision = desktop.sync.revision();
  await desktop.account.signOut();
  await desktop.sync.idle();

  assert.deepEqual(
    browseLibrary(desktop.db, { kind: "songs" }, 0, 50).items.map((row) => row.title),
    ["Airbag"],
  );
  assert.ok(desktop.sync.revision() > revision);
  // Signed out, nothing goes to the service: not a play's end, not the 15 minutes.
  const sent = desktop.requests();
  desktop.sync.played("ended");
  desktop.sync.edited({ songs: true });
  await desktop.pass(DESKTOP_SYNC_PERIOD_MS * 2);
  await desktop.sync.idle();
  assert.equal(desktop.requests(), sent);
});

test("deleting the account keeps the desktop's songs, playlists and stars, and stops syncing", async () => {
  const desktop = await desktopApp();
  const airbag = addTrack(desktop.db, { title: "Airbag", ...OK_COMPUTER });
  createPlaylist(desktop.db, "Mine", [{ source: "library", trackId: airbag }], Date.now());
  const lucky = addTrack(desktop.phone.db, { title: "Lucky", ...OK_COMPUTER });
  createPlaylist(desktop.phone.db, "Drive", [{ source: "library", trackId: lucky }], Date.now());
  await desktop.phone.sync();
  desktop.sync.start();
  await desktop.account.signIn();
  await desktop.sync.idle();
  assert.equal(browseLibrary(desktop.db, { kind: "songs" }, 0, 50).total, 2);

  await desktop.account.deleteAccount();
  await desktop.sync.idle();

  assert.equal(desktop.account.view().account.kind, "signedOut");
  // As signing out: the account's song with no file here goes, what has a file stays.
  assert.deepEqual(
    browseLibrary(desktop.db, { kind: "songs" }, 0, 50).items.map((row) => row.title),
    ["Airbag"],
  );
  assert.deepEqual(playlistSongs(desktop.db, "Mine"), [{ title: "Airbag", missing: false }]);
  const sent = desktop.requests();
  desktop.sync.edited({ songs: true });
  await desktop.pass(DESKTOP_SYNC_PERIOD_MS * 2);
  await desktop.sync.idle();
  assert.equal(desktop.requests(), sent);
  assert.equal((await desktop.service.request("GET", "/v1/pull", { session: desktop.phoneSession })).status, 401);
});

test("a desktop opened signed in syncs at once", async () => {
  const desktop = await desktopApp();
  await desktop.account.signIn();
  const airbag = addTrack(desktop.phone.db, { title: "Airbag", ...OK_COMPUTER });
  createPlaylist(desktop.phone.db, "Drive", [{ source: "library", trackId: airbag }], Date.now());
  await desktop.phone.sync();

  desktop.sync.start();
  await desktop.sync.idle();

  assert.equal(playlistCount(desktop.db), 1);
});
