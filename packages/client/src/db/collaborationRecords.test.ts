/// <reference types="node" />
/**
 * What the owner's phone writes to its collaboration record as the menu's actions are answered
 * (docs/spec.md, "Collaborative playlists", The menu): the members the service listed, and an
 * ended collaboration forgotten at once instead of at the next account pull.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Collaboration, CollaborationMember } from "@wave/core";
import { sql } from "drizzle-orm";

import {
  applyMembership,
  convertToCollaborative,
  forgetCollaboration,
  keepCollaborationMembers,
  keepInviteLink,
  selectCollaborations,
  selectInviteLink,
} from "./collaborations.ts";
import { createPlaylist, selectPlaylists } from "./playlists.ts";
import * as schema from "./schema.ts";
import { openTestDatabase } from "./testDatabase.ts";

const member = (accountId: string, owner = false): CollaborationMember => ({
  accountId,
  name: accountId,
  joinedAt: 0,
  owner,
  self: owner,
});

const madeCollaborative = async () => {
  const db = await openTestDatabase();
  const { playlistId } = createPlaylist(db, "Friday", [], 1000);
  const syncId = selectPlaylists(db)[0]!.syncId!;
  const collaboration: Collaboration = {
    playlistId: syncId,
    members: [member("leo", true), member("ana")],
  };
  convertToCollaborative(db, playlistId, collaboration, 2000);
  return { db, playlistId, syncId };
};

test("the members the service listed replace those the record held", async () => {
  const { db, syncId } = await madeCollaborative();
  keepCollaborationMembers(db, { playlistId: syncId, members: [member("leo", true)] });
  assert.deepEqual(
    selectCollaborations(db).map((each) => each.members.map(({ accountId }) => accountId)),
    [["leo"]],
  );
});

test("members of a playlist this device has no record of are not kept", async () => {
  const { db } = await madeCollaborative();
  keepCollaborationMembers(db, { playlistId: "elsewhere", members: [member("x", true)] });
  assert.equal(selectCollaborations(db).length, 1);
});

test("an ended collaboration is forgotten, and the playlist stays the owner's", async () => {
  const { db, syncId } = await madeCollaborative();
  keepInviteLink(db, syncId, { url: "https://x/invite#t", expiresAt: 9000 });
  forgetCollaboration(db, syncId);
  assert.deepEqual(selectCollaborations(db), []);
  assert.equal(selectInviteLink(db, syncId), null);
  assert.deepEqual(
    selectPlaylists(db).map(({ name }) => name),
    ["Friday"],
  );
});

test("a membership change applies whole or not at all, private copies included", async () => {
  const db = await openTestDatabase();
  createPlaylist(db, "Left", [], 1000);
  createPlaylist(db, "Removed", [], 1000);
  const syncIdOf = (name: string) =>
    selectPlaylists(db).find((each) => each.name === name)!.syncId!;
  const left = syncIdOf("Left");
  const removed = syncIdOf("Removed");
  for (const syncId of [left, removed]) {
    db.insert(schema.collaborations)
      .values({
        playlistSyncId: syncId,
        owned: false,
        ownerAccountId: "ana",
        members: JSON.stringify([member("ana", true)]),
      })
      .run();
  }
  const membership = {
    collaborations: [],
    ended: [
      { playlistId: left, reason: "left" as const, endedAt: 5000 },
      { playlistId: removed, reason: "ended" as const, endedAt: 5000 },
    ],
  };
  // The private copy fails partway: nothing of the change stays.
  db.run(sql`CREATE TRIGGER fail_copy BEFORE INSERT ON private_copy_notices
             BEGIN SELECT RAISE(ABORT, 'no copy'); END`);
  assert.throws(() => applyMembership(db, membership));
  assert.deepEqual(
    selectPlaylists(db)
      .map(({ name }) => name)
      .toSorted(),
    ["Left", "Removed"],
  );
  assert.equal(selectCollaborations(db).length, 2);

  // Applied again once it can be: the left playlist goes and the other becomes a copy.
  db.run(sql`DROP TRIGGER fail_copy`);
  assert.equal(applyMembership(db, membership), true);
  assert.deepEqual(
    selectPlaylists(db).map(({ name }) => name),
    ["Removed"],
  );
  assert.deepEqual(selectCollaborations(db), []);
});
