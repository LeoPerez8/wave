/// <reference types="node" />
/**
 * What the owner's phone writes to its collaboration record as the menu's actions are answered
 * (docs/spec.md, "Collaborative playlists", The menu): the members the service listed, and an
 * ended collaboration forgotten at once instead of at the next account pull.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Collaboration, CollaborationMember } from "@wave/core";

import {
  convertToCollaborative,
  forgetCollaboration,
  keepCollaborationMembers,
  keepInviteLink,
  selectCollaborations,
  selectInviteLink,
} from "./collaborations.ts";
import { createPlaylist, selectPlaylists } from "./playlists.ts";
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
