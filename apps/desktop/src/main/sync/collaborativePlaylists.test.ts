/**
 * Collaborative playlists on the desktop (docs/spec-desktop.md, Wave account and sync): it
 * shows and plays them and edits none, for the owner and for the other members; a member's
 * desktop pulls each one with its own requests and pushes nothing. Ana's phone owns the
 * playlist; the desktops run their sync against the sync Worker's harness.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Database } from "@wave/client";
import { convertToCollaborative } from "@wave/client/db/collaborations";
import { creditSplits } from "@wave/client/db/credits";
import type { LibraryDatabase } from "@wave/client/db/database";
import {
  addToPlaylist,
  createPlaylist,
  removePlaylistItems,
  renamePlaylist,
  selectPlaylist,
  selectPlaylists,
} from "@wave/client/db/playlists";
import { collaborationService } from "@wave/client/sync/collaborationService";
import { syncCycle, type SyncTransport } from "@wave/client/sync/syncCycle";
import { addTrack, openTestDatabase, type TestDatabase } from "@wave/client/testing";
import { DESKTOP_SYNC_PERIOD_MS } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { fakeClock } from "../../../../../packages/core/src/testSyncClock.ts";
import { libraryLayer } from "../database.ts";
import { browseLibrary } from "../library/browse.ts";
import type { BrowserSignInPurpose } from "../account/account.ts";
import { sessionStore, type SessionFiles } from "../account/sessionStore.ts";
import { DESKTOP_CLIENT, desktop, keyring } from "../account/testAccount.ts";
import { createDesktopSync } from "./desktopSync.ts";

const OK_COMPUTER = { artist: "Radiohead", album: "OK Computer" };

const desktopLibrary = async (): Promise<TestDatabase> => {
  const folder = mkdtempSync(join(tmpdir(), "wave-desktop-collab-"));
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

/**
 * Ana's phone with "Drive" (Airbag, Lucky) made collaborative and an invite Bea joined,
 * Bea's desktop and Ana's own desktop, each signed in and syncing.
 */
const shared = async () => {
  const app = await desktop();
  const anaSession = await app.service.signIn();
  const anaTransport: SyncTransport & Parameters<typeof collaborationService>[0] = {
    request: async (method, path, body) => {
      const response = await app.service.request(method, path, {
        session: anaSession,
        ...(body === null ? {} : { body, headers: { "content-type": "application/json" } }),
      });
      return { status: response.status, body: await response.text() };
    },
  };
  const owner = collaborationService(anaTransport);
  const phone = await openTestDatabase();
  // Behind the service's clock, so it keeps each change's own time.
  let clock = 1_000_000;
  const now = () => (clock += 1_000);
  const phoneSync = () =>
    syncCycle({
      db: phone,
      splits: creditSplits(),
      transport: anaTransport,
      account: "ana@example.com",
      preferences: { value: () => null, apply: () => {} },
      now,
      songsChanged: true,
      wait: async () => {},
      collaboration: owner,
    });
  const airbag = addTrack(phone, { title: "Airbag", ...OK_COMPUTER, durationMs: 284_000 });
  const lucky = addTrack(phone, { title: "Lucky", ...OK_COMPUTER, durationMs: 259_000 });
  const karma = addTrack(phone, { title: "Karma Police", ...OK_COMPUTER, durationMs: 264_000 });
  const made = createPlaylist(
    phone,
    "Drive",
    [
      { source: "library", trackId: airbag },
      { source: "library", trackId: lucky },
    ],
    now(),
  );
  await phoneSync();
  const syncId = phone.get<{ id: string }>(
    sql`SELECT sync_id AS id FROM playlists WHERE id=${made.playlistId}`,
  )!.id;
  const collaboration = await owner.make(syncId);
  if (collaboration.type !== "done") throw new Error("not collaborative");
  convertToCollaborative(phone, made.playlistId, collaboration.value, now());
  await phoneSync();
  const invite = await owner.createInvite(syncId);
  if (invite.type !== "done") throw new Error("no invite");

  const disk = new Map<string, Buffer>();
  const files: SessionFiles = {
    read: (path) => disk.get(path),
    write: (path, bytes) => void disk.set(path, bytes),
    remove: (path) => void disk.delete(path),
  };
  const bea = app.open({
    store: sessionStore({ box: keyring, file: "bea.bin", files, platform: "win32" }),
    signInWithBrowser: async (_signal: AbortSignal, _purpose: BrowserSignInPurpose) => ({
      idToken: await app.service.google.idToken({
        aud: DESKTOP_CLIENT,
        sub: "google-sub-bea",
        email: "bea@example.com",
        name: "Bea",
      }),
      email: "bea@example.com",
      name: "Bea",
      photoUrl: null,
    }),
  });
  await bea.signIn();
  const joined = await collaborationService(bea).join(invite.value.url.split("#")[1]!);
  if (joined.type !== "done") throw new Error("Bea didn't join");

  /** A desktop of [account] with Airbag in its Library; every request it sends is kept. */
  const desk = async (account: ReturnType<typeof app.open>) => {
    const db = await desktopLibrary();
    addTrack(db, { title: "Airbag", ...OK_COMPUTER, durationMs: 284_000 });
    const requests: string[] = [];
    const watched = {
      ...account,
      request: (...args: Parameters<typeof account.request>) => {
        requests.push(`${args[0]} ${args[1].split("?")[0]}`);
        return account.request(...args);
      },
    };
    const { clock: deskClock, pass } = fakeClock();
    const sync = createDesktopSync({
      db,
      account: watched,
      clock: deskClock,
      focused: () => true,
      wait: async () => {},
    });
    after(() => sync.dispose());
    sync.start();
    await sync.idle();
    return { db, sync, pass, requests };
  };
  const beaDesk = await desk(bea);
  const ana = app.open();
  await ana.signIn();
  const anaDesk = await desk(ana);
  return { phone, phoneSync, now, karma, made, beaDesk, anaDesk };
};

const playlistRow = (db: LibraryDatabase) => {
  const rows = browseLibrary(db, { kind: "playlists" }, 0, 50).items;
  assert.equal(rows.length, 1, "one playlist");
  return rows[0]!;
};

const titles = (db: LibraryDatabase) => {
  const row = playlistRow(db);
  return selectPlaylist(db, row.id)?.items.map((item) =>
    item.source === "library" ? item.track.title : item.song.title,
  );
};

test("a member's desktop shows the playlist after a sync, marked collaborative, and follows later changes", async () => {
  const { phone, phoneSync, now, karma, made, beaDesk } = await shared();
  assert.equal(playlistRow(beaDesk.db).title, "Drive");
  assert.equal(playlistRow(beaDesk.db).collaborative, true);
  assert.deepEqual(titles(beaDesk.db), ["Airbag", "Lucky"]);

  renamePlaylist(phone, made.playlistId, "Drive Home", now());
  addToPlaylist(phone, made.playlistId, [{ source: "library", trackId: karma }], now());
  await phoneSync();
  await beaDesk.pass(DESKTOP_SYNC_PERIOD_MS);
  await beaDesk.sync.idle();
  assert.equal(playlistRow(beaDesk.db).title, "Drive Home");
  assert.deepEqual(titles(beaDesk.db), ["Airbag", "Lucky", "Karma Police"]);
  assert.ok(beaDesk.requests.includes("GET /v1/collaboration/pull"), "pulled per playlist");
});

test("a member's desktop pushes nothing of the playlist, even a change in its store", async () => {
  const { phone, phoneSync, beaDesk } = await shared();
  const row = playlistRow(beaDesk.db);
  const entries = selectPlaylist(beaDesk.db, row.id)!.items.map((item) => item.itemId);
  removePlaylistItems(beaDesk.db, row.id, entries.slice(0, 1), Date.now());
  beaDesk.sync.edited({ songs: false });
  await beaDesk.pass(DESKTOP_SYNC_PERIOD_MS);
  await beaDesk.sync.idle();
  assert.ok(!beaDesk.requests.includes("POST /v1/collaboration/push"), "no member push");
  await phoneSync();
  const ownerRow = selectPlaylists(phone)[0]!;
  assert.deepEqual(
    selectPlaylist(phone, ownerRow.id)?.items.map((item) =>
      item.source === "library" ? item.track.title : item.song.title,
    ),
    ["Airbag", "Lucky"],
  );
});

test("the owner's desktop marks its own collaborative playlist", async () => {
  const { anaDesk } = await shared();
  assert.equal(playlistRow(anaDesk.db).title, "Drive");
  assert.equal(playlistRow(anaDesk.db).collaborative, true);
});
