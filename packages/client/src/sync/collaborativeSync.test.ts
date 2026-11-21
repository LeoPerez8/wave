/// <reference types="node" />
/**
 * Collaborative playlists across accounts (docs/spec.md, "Collaborative playlists"): each
 * phone runs the sync cycle against one service holding several accounts
 * (`testCollaborationService.ts`), with the collaboration service unless a test says.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  convertToCollaborative,
  leaveCollaborativePlaylist,
  markCollaborationSeen,
  selectCollaborations,
  selectPrivateCopyNotices,
} from "../db/collaborations.ts";
import { creditSplits } from "../db/credits.ts";
import { removeTracks, signOut } from "../db/missingSongs.ts";
import {
  addToPlaylist,
  deletePlaylist,
  createPlaylist,
  movePlaylistItem,
  removePlaylistItems,
  renamePlaylist,
  selectPlaylist,
  selectPlaylists,
} from "../db/playlists.ts";
import * as schema from "../db/schema.ts";
import {
  addTrack,
  openTestDatabase,
  traceQueriesAsync,
  type FixtureTrack,
} from "../db/testDatabase.ts";
import { collaborationService } from "./collaborationService.ts";
import { syncCollaborativePlaylist, syncCycle, type SyncPreferences } from "./syncCycle.ts";
import { testCollaborationWorld, type TestAccount } from "./testCollaborationService.ts";

const AIRBAG: FixtureTrack = {
  title: "Airbag",
  album: "OK Computer",
  artist: "Radiohead",
  trackNumber: 1,
  durationMs: 284_000,
};
const LUCKY: FixtureTrack = {
  title: "Lucky",
  album: "OK Computer",
  artist: "Radiohead",
  trackNumber: 11,
  durationMs: 259_000,
};
const KARMA: FixtureTrack = {
  title: "Karma Police",
  album: "OK Computer",
  artist: "Radiohead",
  trackNumber: 6,
  durationMs: 264_000,
};
/** Airbag as another Library tags it: another recording key, the same song. */
const AIRBAG_RETAGGED: FixtureTrack = {
  title: "Airbag",
  album: "OK Computer (Remastered)",
  artist: "Radiohead",
  durationMs: 285_000,
};

/** A phone of [account], signed in, with [songs]; [collaborative] gives it the collaboration service. */
const phone = async (
  account: TestAccount,
  songs: readonly FixtureTrack[],
  { collaborative = true }: { readonly collaborative?: boolean } = {},
) => {
  const db = await openTestDatabase();
  const splits = creditSplits();
  const tracks = new Map(songs.map((song) => [song.title, addTrack(db, song)]));
  let clock = 1_000;
  const stored = new Map<string, string>();
  const preferences: SyncPreferences = {
    value: (key) => stored.get(key) ?? null,
    apply: (key, value) => {
      if (value === null) stored.delete(key);
      else stored.set(key, value);
    },
  };
  const now = () => (clock += 1_000);
  const track = (title: string): number => {
    const id = tracks.get(title);
    if (id === undefined) throw new Error(`no ${title}`);
    return id;
  };
  /** The phone's playlist named [name]: its local id and sync id. */
  const playlist = (name: string) => {
    const row = selectPlaylists(db).find((each) => each.name === name);
    if (row === undefined) throw new Error(`no playlist ${name}`);
    const syncId = db
      .select({ syncId: schema.playlists.syncId })
      .from(schema.playlists)
      .where(eq(schema.playlists.id, row.id))
      .get()?.syncId;
    return { id: row.id, syncId: syncId ?? "" };
  };
  const input = () => ({
    db,
    splits,
    transport: account,
    preferences,
    account: `${account.id}@example.com`,
    now,
    songsChanged: false,
    wait: async () => {},
    ...(collaborative ? { collaboration: collaborationService(account) } : {}),
  });
  return {
    db,
    now,
    track,
    playlist,
    signOut: () => signOut(db, splits),
    sync: () => syncCycle(input()),
    /** The page of the playlist [playlistId] pulls it (`syncCollaborativePlaylist`). */
    syncPage: (playlistId: number) => syncCollaborativePlaylist(input(), playlistId),
  };
};

type Phone = Awaited<ReturnType<typeof phone>>;

/** Each playlist on [device] with its songs: a Library song's title, else `<source>:<title>`. */
const playlists = (device: Phone) =>
  selectPlaylists(device.db).map((row) => ({
    name: row.name,
    songs:
      selectPlaylist(device.db, row.id)?.items.map((item) =>
        item.source === "library" ? item.track.title : `${item.source}:${item.song.title}`,
      ) ?? [],
  }));

/** Ana's phone owns "Drive" (Airbag, Lucky), made collaborative; Bea joined it. */
const shared = async ({ pageSize }: { readonly pageSize?: number } = {}) => {
  const world = testCollaborationWorld(pageSize === undefined ? {} : { pageSize });
  const ana = await phone(world.account("ana"), [AIRBAG, LUCKY]);
  const bea = await phone(world.account("bea"), [AIRBAG_RETAGGED, KARMA]);
  createPlaylist(
    ana.db,
    "Drive",
    [
      { source: "library", trackId: ana.track("Airbag") },
      { source: "library", trackId: ana.track("Lucky") },
    ],
    ana.now(),
  );
  await ana.sync();
  const drive = ana.playlist("Drive");
  world.make("ana", drive.syncId);
  const members = await collaborationService(world.account("ana")).members(drive.syncId);
  if (members.type !== "done") throw new Error("not collaborative");
  convertToCollaborative(ana.db, drive.id, members.value, ana.now());
  await ana.sync();
  world.join("bea", drive.syncId);
  return { world, ana, bea, drive };
};

describe("a member's device", () => {
  test("shows the owner's playlist after a cycle, and its own changes reach the owner", async () => {
    const { world, ana, bea } = await shared();
    await bea.sync();
    assert.deepEqual(playlists(bea), [{ name: "Drive", songs: ["Airbag", "unsearched:Lucky"] }]);

    addToPlaylist(
      bea.db,
      bea.playlist("Drive").id,
      [{ source: "library", trackId: bea.track("Karma Police") }],
      bea.now(),
    );
    await bea.sync();
    await ana.sync();
    assert.deepEqual(playlists(ana), [
      { name: "Drive", songs: ["Airbag", "Lucky", "unsearched:Karma Police"] },
    ]);
    // The playlist stays in the owner's account: nothing of it went to Bea's.
    assert.deepEqual(world.account("bea").service.rows().playlists, []);
    assert.deepEqual(world.account("bea").service.rows().playlistEntries, []);
  });
});

describe("without the collaboration service", () => {
  test("a member's phone shows nothing of the playlist and sends no collaboration request", async () => {
    const { world } = await shared();
    const bea = await phone(world.account("bea"), [KARMA], { collaborative: false });
    await bea.sync();
    assert.deepEqual(playlists(bea), []);
    assert.deepEqual(
      world.account("bea").requests.filter((request) => request.includes("/v1/collaboration")),
      [],
    );
    assert.deepEqual(selectCollaborations(bea.db), []);
  });

  test("the owner's playlist syncs as before, its entries going up without song fields", async () => {
    const world = testCollaborationWorld();
    const ana = await phone(world.account("ana"), [AIRBAG], { collaborative: false });
    createPlaylist(
      ana.db,
      "Drive",
      [{ source: "library", trackId: ana.track("Airbag") }],
      ana.now(),
    );
    await ana.sync();
    world.make("ana", ana.playlist("Drive").syncId);
    await ana.sync();
    const [entry] = world.account("ana").service.rows().playlistEntries;
    assert.equal(entry !== undefined && "title" in entry, false);
    assert.deepEqual(selectCollaborations(ana.db), []);
  });
});

describe("when membership ends", () => {
  test("a removed member keeps one private copy with the edits that never went up", async () => {
    const { world, ana, drive } = await shared();
    const bea = await phone(world.account("bea"), [AIRBAG_RETAGGED, KARMA]);
    const beaTablet = await phone(world.account("bea"), [AIRBAG_RETAGGED]);
    await bea.sync();
    await beaTablet.sync();
    // Offline on Bea's phone: this never goes up to the playlist.
    addToPlaylist(
      bea.db,
      bea.playlist("Drive").id,
      [{ source: "library", trackId: bea.track("Karma Police") }],
      bea.now(),
    );
    world.remove(drive.syncId, "bea");

    await bea.sync();
    await beaTablet.sync();
    await bea.sync();
    const copy = { name: "Drive", songs: ["Airbag", "unsearched:Lucky", "Karma Police"] };
    assert.deepEqual(playlists(bea), [copy]);
    // Karma Police is a missing song on the tablet: the account's song list holds it.
    assert.deepEqual(playlists(beaTablet), [copy]);
    // One copy in Bea's own account, however many of her devices made it.
    assert.deepEqual(
      world
        .account("bea")
        .service.rows()
        .playlists.map((row) => !row.deleted && row.name),
      ["Drive"],
    );
    assert.deepEqual(selectPrivateCopyNotices(bea.db), [bea.playlist("Drive").id]);
    assert.deepEqual(selectCollaborations(bea.db), []);
    // The owner's playlist is as it was.
    await ana.sync();
    assert.deepEqual(playlists(ana), [{ name: "Drive", songs: ["Airbag", "Lucky"] }]);
  });

  test("a refused request turns the playlist into a private copy", async () => {
    const { world, drive } = await shared();
    const account = world.account("bea");
    let removeOnPull = false;
    // The account pull still lists the playlist; the playlist's own request is refused.
    const stale: TestAccount = {
      ...account,
      request: async (method, path, body) => {
        if (removeOnPull && path.startsWith("/v1/collaboration/pull"))
          world.remove(drive.syncId, "bea");
        return account.request(method, path, body);
      },
    };
    const bea = await phone(stale, [AIRBAG_RETAGGED, KARMA]);
    await bea.sync();
    removeOnPull = true;
    await bea.sync();
    assert.deepEqual(playlists(bea), [{ name: "Drive", songs: ["Airbag", "unsearched:Lucky"] }]);
    assert.deepEqual(selectCollaborations(bea.db), []);
    assert.equal(selectPrivateCopyNotices(bea.db).length, 1);
    assert.deepEqual(
      account.service.rows().playlists.map((row) => !row.deleted && row.name),
      ["Drive"],
    );
  });

  test("the owner deleting the playlist leaves the member a private copy", async () => {
    const { world, ana, bea } = await shared();
    await bea.sync();
    deletePlaylist(ana.db, ana.playlist("Drive").id, ana.now());
    await ana.sync();
    await bea.sync();
    assert.deepEqual(playlists(bea), [{ name: "Drive", songs: ["Airbag", "unsearched:Lucky"] }]);
    assert.equal(selectPrivateCopyNotices(bea.db).length, 1);
    assert.equal(world.account("bea").service.rows().playlists.length, 1);
  });
});

describe("leaving and signing out", () => {
  test("Leave takes the playlist from every device of the member; its entries stay", async () => {
    const { world, ana, bea, drive } = await shared();
    const beaTablet = await phone(world.account("bea"), [AIRBAG_RETAGGED]);
    await bea.sync();
    await beaTablet.sync();
    addToPlaylist(
      bea.db,
      bea.playlist("Drive").id,
      [{ source: "library", trackId: bea.track("Karma Police") }],
      bea.now(),
    );
    await bea.sync();

    const left = await collaborationService(world.account("bea")).leave(drive.syncId);
    assert.equal(left.type, "done");
    leaveCollaborativePlaylist(bea.db, drive.syncId);
    assert.deepEqual(playlists(bea), []);
    await bea.sync();
    await beaTablet.sync();
    assert.deepEqual(playlists(bea), []);
    assert.deepEqual(playlists(beaTablet), []);
    assert.deepEqual(selectPrivateCopyNotices(beaTablet.db), []);
    await ana.sync();
    assert.deepEqual(playlists(ana), [
      { name: "Drive", songs: ["Airbag", "Lucky", "unsearched:Karma Police"] },
    ]);
  });

  test("signing out drops the playlists the account doesn't own; signing in brings them back", async () => {
    const { ana, bea } = await shared();
    await bea.sync();
    bea.signOut();
    ana.signOut();
    assert.deepEqual(playlists(bea), []);
    // The owner's own stays.
    assert.deepEqual(playlists(ana), [{ name: "Drive", songs: ["Airbag", "Lucky"] }]);
    await bea.sync();
    await ana.sync();
    assert.deepEqual(playlists(bea), [{ name: "Drive", songs: ["Airbag", "unsearched:Lucky"] }]);
    assert.deepEqual(playlists(ana), [{ name: "Drive", songs: ["Airbag", "Lucky"] }]);
    assert.deepEqual(
      selectCollaborations(ana.db).map((each) => each.owned),
      [true],
    );
  });
});

describe("the changed mark", () => {
  const unseen = (device: Phone) =>
    selectCollaborations(device.db).map((each) => [each.syncId.length > 0, each.unseen]);

  test("a pull that brings another device's change marks the playlist until it is opened", async () => {
    const { ana, bea } = await shared();
    await bea.sync();
    assert.deepEqual(unseen(bea), [[true, false]]);

    renamePlaylist(ana.db, ana.playlist("Drive").id, "Night Drive", ana.now());
    await ana.sync();
    await bea.sync();
    assert.deepEqual(unseen(bea), [[true, true]]);
    markCollaborationSeen(bea.db, bea.playlist("Night Drive").id);
    assert.deepEqual(unseen(bea), [[true, false]]);

    // The member's own change, back from its push, marks nothing on its device.
    const drive = bea.playlist("Night Drive").id;
    const lucky = selectPlaylist(bea.db, drive)?.items[1]?.itemId ?? -1;
    movePlaylistItem(bea.db, drive, lucky, 0, bea.now());
    await bea.sync();
    assert.deepEqual(unseen(bea), [[true, false]]);
    // The owner's device learns of it through its account pull, and is marked.
    assert.deepEqual(unseen(ana), [[true, false]]);
    await ana.sync();
    assert.deepEqual(unseen(ana), [[true, true]]);
    assert.deepEqual(playlists(ana), [{ name: "Night Drive", songs: ["Lucky", "Airbag"] }]);
  });

  test("the mark is kept per device", async () => {
    const { world, ana, bea } = await shared();
    const beaTablet = await phone(world.account("bea"), [AIRBAG_RETAGGED]);
    await bea.sync();
    await beaTablet.sync();
    removePlaylistItems(
      ana.db,
      ana.playlist("Drive").id,
      [selectPlaylist(ana.db, ana.playlist("Drive").id)?.items[1]?.itemId ?? -1],
      ana.now(),
    );
    await ana.sync();
    await bea.sync();
    await beaTablet.sync();
    markCollaborationSeen(bea.db, bea.playlist("Drive").id);
    assert.deepEqual(unseen(bea), [[true, false]]);
    assert.deepEqual(unseen(beaTablet), [[true, true]]);
  });
});

describe("one playlist's trouble", () => {
  test("a failing playlist stops neither the account's own sync nor the other playlists", async () => {
    const { world, ana, drive } = await shared();
    const caio = await phone(world.account("caio"), [KARMA]);
    createPlaylist(
      caio.db,
      "Gym",
      [{ source: "library", trackId: caio.track("Karma Police") }],
      caio.now(),
    );
    await caio.sync();
    const gym = caio.playlist("Gym").syncId;
    world.make("caio", gym);
    world.join("bea", gym);
    const account = world.account("bea");
    const failing: TestAccount = {
      ...account,
      request: async (method, path, body) =>
        path.includes(`playlist=${gym}`)
          ? { status: 500, body: '{"error":"internal"}' }
          : account.request(method, path, body),
    };
    const bea = await phone(failing, [AIRBAG_RETAGGED, KARMA]);
    createPlaylist(
      bea.db,
      "Mine",
      [{ source: "library", trackId: bea.track("Karma Police") }],
      bea.now(),
    );
    await bea.sync();
    assert.deepEqual(playlists(bea), [
      { name: "Drive", songs: ["Airbag", "unsearched:Lucky"] },
      { name: "Mine", songs: ["Karma Police"] },
    ]);
    assert.deepEqual(
      account.service.rows().playlists.map((row) => !row.deleted && row.name),
      ["Mine"],
    );
    // Gym stays, waiting for its next cycle.
    assert.deepEqual(
      selectCollaborations(bea.db).map((each) => [each.syncId === gym, each.playlistId === null]),
      [drive.syncId, gym].sort().map((id) => [id === gym, id === gym]),
    );
    await ana.sync();
  });

  test("a full playlist keeps the member's change waiting for the next cycle", async () => {
    const { world, ana, bea } = await shared();
    await bea.sync();
    world.account("ana").service.rowLimits.playlistEntries = 2;
    addToPlaylist(
      bea.db,
      bea.playlist("Drive").id,
      [{ source: "library", trackId: bea.track("Karma Police") }],
      bea.now(),
    );
    await bea.sync();
    assert.equal(selectCollaborations(bea.db).length, 1);
    assert.deepEqual(selectPrivateCopyNotices(bea.db), []);
    world.account("ana").service.rowLimits = {};
    await bea.sync();
    await ana.sync();
    assert.deepEqual(playlists(ana), [
      { name: "Drive", songs: ["Airbag", "Lucky", "unsearched:Karma Police"] },
    ]);
  });

  test("a playlist that passed to another owner is pulled again from the start", async () => {
    const { world, bea, drive } = await shared();
    const caio = await phone(world.account("caio"), [LUCKY]);
    world.join("caio", drive.syncId);
    await bea.sync();
    await caio.sync();
    world.passTo(drive.syncId, "caio");
    await bea.sync();
    const pulls = world
      .account("bea")
      .requests.filter((request) => request.startsWith("GET /v1/collaboration/pull"));
    // The pull after the owner changed starts from no cursor, as the first one did.
    assert.equal(pulls.at(-1), `GET /v1/collaboration/pull?playlist=${drive.syncId}`);
    assert.equal(pulls.filter((request) => !request.includes("since")).length, 2);
    assert.deepEqual(playlists(bea), [{ name: "Drive", songs: ["Airbag", "unsearched:Lucky"] }]);
    // The heir's device now syncs it with its account.
    await caio.sync();
    assert.deepEqual(
      selectCollaborations(caio.db).map((each) => each.owned),
      [true],
    );
    assert.deepEqual(playlists(caio), [{ name: "Drive", songs: ["unsearched:Airbag", "Lucky"] }]);
  });
});

describe("matching entries", () => {
  test("converting sends the Library entries' fields, and a video id makes an unmatched one stream", async () => {
    const world = testCollaborationWorld();
    const ana = await phone(world.account("ana"), [AIRBAG, LUCKY]);
    ana.db
      .update(schema.tracks)
      .set({ videoId: "luckyVideo1" })
      .where(eq(schema.tracks.id, ana.track("Lucky")))
      .run();
    createPlaylist(
      ana.db,
      "Drive",
      [{ source: "library", trackId: ana.track("Lucky") }],
      ana.now(),
    );
    await ana.sync();
    const drive = ana.playlist("Drive");
    world.make("ana", drive.syncId);
    const members = await collaborationService(world.account("ana")).members(drive.syncId);
    if (members.type !== "done") throw new Error("not collaborative");
    convertToCollaborative(ana.db, drive.id, members.value, ana.now());
    await ana.sync();
    const [entry] = world.account("ana").service.rows().playlistEntries;
    assert.deepEqual(
      entry !== undefined &&
        !entry.deleted && {
          title: entry.title,
          credit: entry.credit,
          album: entry.album,
          durationMs: entry.durationMs,
          videoId: entry.videoId,
        },
      {
        title: "Lucky",
        credit: "Radiohead",
        album: "OK Computer",
        durationMs: 259_000,
        videoId: "luckyVideo1",
      },
    );

    world.join("bea", drive.syncId);
    const bea = await phone(world.account("bea"), [KARMA]);
    await bea.sync();
    assert.deepEqual(playlists(bea), [{ name: "Drive", songs: ["stream:Lucky"] }]);
    // Bea's move goes up as the Library entry it came as, not as her stream.
    const lucky = selectPlaylist(bea.db, bea.playlist("Drive").id)?.items[0]?.itemId ?? -1;
    addToPlaylist(
      bea.db,
      bea.playlist("Drive").id,
      [{ source: "library", trackId: bea.track("Karma Police") }],
      bea.now(),
    );
    movePlaylistItem(bea.db, bea.playlist("Drive").id, lucky, 1, bea.now());
    await bea.sync();
    await ana.sync();
    assert.deepEqual(playlists(ana), [
      { name: "Drive", songs: ["unsearched:Karma Police", "Lucky"] },
    ]);
  });
});

describe("the page's own pull", () => {
  test("a member's page pulls that playlist alone, and pushes what waits in it", async () => {
    const { world, ana, bea } = await shared();
    await bea.sync();
    renamePlaylist(ana.db, ana.playlist("Drive").id, "Night Drive", ana.now());
    await ana.sync();
    const drive = bea.playlist("Drive").id;
    addToPlaylist(
      bea.db,
      drive,
      [{ source: "library", trackId: bea.track("Karma Police") }],
      bea.now(),
    );
    const asked = world.account("bea").requests.length;

    const result = await bea.syncPage(drive);
    assert.equal(result.pulled.playlists, true);
    assert.equal(bea.playlist("Night Drive").id, drive);
    const requests = world.account("bea").requests.slice(asked);
    assert.ok(requests.length > 0);
    assert.ok(
      requests.every((request) => request.includes("/v1/collaboration/")),
      "nothing of the account's own sync",
    );
    await ana.sync();
    assert.deepEqual(playlists(ana), [
      { name: "Night Drive", songs: ["Airbag", "Lucky", "unsearched:Karma Police"] },
    ]);
  });

  test("the owner's page pulls through the account, and brings the members' changes", async () => {
    const { ana, bea } = await shared();
    await bea.sync();
    renamePlaylist(bea.db, bea.playlist("Drive").id, "Beach", bea.now());
    await bea.sync();

    const result = await ana.syncPage(ana.playlist("Drive").id);
    assert.equal(result.pulled.playlists, true);
    assert.deepEqual(
      playlists(ana).map((each) => each.name),
      ["Beach"],
    );
  });

  test("a page whose playlist ended becomes the member's copy, which goes up", async () => {
    const { world, bea, drive } = await shared();
    await bea.sync();
    world.remove(drive.syncId, "bea");
    const local = bea.playlist("Drive").id;

    const result = await bea.syncPage(local);
    assert.equal(result.pulled.playlists, true);
    assert.deepEqual(selectCollaborations(bea.db), []);
    assert.deepEqual(selectPrivateCopyNotices(bea.db), [local]);
    assert.equal(world.account("bea").service.rows().playlists.length, 1);
  });

  test("a page whose playlist the member left on another device takes it off, with no copy", async () => {
    const { world, drive } = await shared();
    const bea = await phone(world.account("bea"), [AIRBAG_RETAGGED, KARMA]);
    const beaTablet = await phone(world.account("bea"), [AIRBAG_RETAGGED]);
    await bea.sync();
    await beaTablet.sync();
    const left = await collaborationService(world.account("bea")).leave(drive.syncId);
    assert.equal(left.type, "done");
    leaveCollaborativePlaylist(bea.db, drive.syncId);

    const result = await beaTablet.syncPage(beaTablet.playlist("Drive").id);
    assert.equal(result.pulled.playlists, true);
    assert.deepEqual(playlists(beaTablet), []);
    assert.deepEqual(selectPrivateCopyNotices(beaTablet.db), []);
    assert.deepEqual(selectCollaborations(beaTablet.db), []);
    // Nothing of it went up to Bea's account, so her phone gets no copy either.
    assert.deepEqual(world.account("bea").service.rows().playlists, []);
    await bea.sync();
    assert.deepEqual(playlists(bea), []);
  });

  test("an ordinary playlist, or no collaboration service, sends nothing", async () => {
    const world = testCollaborationWorld();
    const ana = await phone(world.account("ana"), [AIRBAG]);
    createPlaylist(
      ana.db,
      "Mine",
      [{ source: "library", trackId: ana.track("Airbag") }],
      ana.now(),
    );
    await ana.sync();
    const asked = world.account("ana").requests.length;
    await ana.syncPage(ana.playlist("Mine").id);
    assert.equal(world.account("ana").requests.length, asked);

    const off = await phone(world.account("cid"), [], { collaborative: false });
    await off.syncPage(1);
    assert.deepEqual(world.account("cid").requests, []);
  });
});

/** Who added each entry of Drive on [device]. */
const adders = (device: Phone) =>
  selectPlaylist(device.db, device.playlist("Drive").id)?.items.map((item) => item.addedBy);

describe("who added each entry", () => {
  test("every device reads the account that added each entry", async () => {
    const { ana, bea } = await shared();
    await bea.sync();
    addToPlaylist(
      bea.db,
      bea.playlist("Drive").id,
      [{ source: "library", trackId: bea.track("Karma Police") }],
      bea.now(),
    );
    await bea.sync();
    await ana.sync();
    assert.deepEqual(adders(ana), ["ana", "ana", "bea"]);
    assert.deepEqual(adders(bea), ["ana", "ana", "bea"]);
  });
});

describe("a member's Library song leaving", () => {
  test("its entry in the owner's playlist stays, on the member's device and for the others", async () => {
    const { world, ana, bea } = await shared();
    await bea.sync();
    assert.deepEqual(playlists(bea), [{ name: "Drive", songs: ["Airbag", "unsearched:Lucky"] }]);

    // A file the scan now skips takes its own entries along (`removeTracks`, "leave").
    bea.db.transaction((tx) =>
      removeTracks(tx, creditSplits(), [bea.track("Airbag")], bea.now(), "leave"),
    );
    assert.deepEqual(playlists(bea), [
      { name: "Drive", songs: ["unsearched:Airbag", "unsearched:Lucky"] },
    ]);
    await bea.sync();
    await ana.sync();
    assert.deepEqual(playlists(ana), [{ name: "Drive", songs: ["Airbag", "Lucky"] }]);
    assert.deepEqual(playlists(bea), [
      { name: "Drive", songs: ["unsearched:Airbag", "unsearched:Lucky"] },
    ]);
    // Nothing of the owner's playlist went to the member's own account.
    assert.deepEqual(world.account("bea").service.rows().playlistEntries, []);
  });
});

describe("a member's first pull of a long playlist", () => {
  test("entries on pages before the playlist's row are placed once the row arrives", async () => {
    const { ana, bea } = await shared({ pageSize: 1 });
    // The rename puts the playlist's row after its entries.
    renamePlaylist(ana.db, ana.playlist("Drive").id, "Night Drive", ana.now());
    await ana.sync();

    await bea.sync();
    assert.deepEqual(playlists(bea), [
      { name: "Night Drive", songs: ["Airbag", "unsearched:Lucky"] },
    ]);
    assert.deepEqual(bea.db.select().from(schema.syncPending).all(), []);
  });
});

/** The statements of [queries] that read every Track. */
const wholeLibraryReads = (queries: readonly { sql: string; plan: readonly string[] }[]) =>
  queries.filter((query) => query.plan.some((step) => /^SCAN tracks\b/.test(step)));

describe("a page's pull every 15 seconds", () => {
  test("a member's pull reads only the Tracks its entries need", async () => {
    const { ana, bea } = await shared();
    await bea.sync();
    const drive = bea.playlist("Drive").id;

    const idle = await traceQueriesAsync(bea.db, () => bea.syncPage(drive));
    assert.deepEqual(wholeLibraryReads(idle.queries), []);

    const id = addTrack(ana.db, KARMA);
    addToPlaylist(
      ana.db,
      ana.playlist("Drive").id,
      [{ source: "library", trackId: id }],
      ana.now(),
    );
    await ana.sync();
    const changed = await traceQueriesAsync(bea.db, () => bea.syncPage(drive));
    assert.equal(changed.result.pulled.playlists, true);
    assert.deepEqual(wholeLibraryReads(changed.queries), []);
    assert.deepEqual(playlists(bea), [
      { name: "Drive", songs: ["Airbag", "unsearched:Lucky", "Karma Police"] },
    ]);
  });

  test("the owner's pull reads no Tracks when nothing changed", async () => {
    const { ana } = await shared();
    await ana.sync();
    const idle = await traceQueriesAsync(ana.db, () => ana.syncPage(ana.playlist("Drive").id));
    assert.deepEqual(wholeLibraryReads(idle.queries), []);
  });
});

describe("the owner's own entries", () => {
  test("the pull that brings who added them reports a playlist change", async () => {
    const { ana } = await shared();
    const id = addTrack(ana.db, KARMA);
    addToPlaylist(
      ana.db,
      ana.playlist("Drive").id,
      [{ source: "library", trackId: id }],
      ana.now(),
    );
    const result = await ana.sync();
    assert.equal(result.pulled.playlists, true);
    assert.deepEqual(adders(ana), ["ana", "ana", "ana"]);
  });
});
