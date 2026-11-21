import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  Collaboration,
  CollaborationResult,
  InviteDetails,
  InviteJoinView,
  InviteNotice,
  WaveSession,
} from "@wave/core";

import { openInvite, type InviteRunnerPorts, type InviteSignIn } from "./inviteJoinRunner.ts";

const TOKEN = "t".repeat(43);
const ANA: WaveSession = {
  status: "signedIn",
  account: { email: "ana@example.com", name: "Ana Souza", photoUrl: null },
};
const DETAILS: InviteDetails = {
  playlistId: "list",
  playlistName: "Rolê de sexta",
  ownerName: "Leo Perez",
};
const JOINED: CollaborationResult<Collaboration> = {
  type: "done",
  value: { playlistId: "list", members: [] },
};

/** A phone with the switch on and Ana signed in, who taps Join; [over] changes any of it. */
const phone = (over: Partial<InviteRunnerPorts> = {}) => {
  const seen = {
    notices: [] as InviteNotice[],
    views: [] as InviteJoinView[],
    lookUps: [] as string[],
    joins: [] as string[],
    joined: [] as string[],
    signInPrompts: 0,
  };
  const ports: InviteRunnerPorts = {
    switchOn: () => true,
    session: async () => ANA,
    language: () => "en",
    askSignIn: async () => {
      seen.signInPrompts += 1;
      return true;
    },
    signIn: async () => ({ type: "signedIn" }),
    lookUp: async (token) => {
      seen.lookUps.push(token);
      return { type: "done", value: DETAILS };
    },
    askJoin: async (view) => {
      seen.views.push(view);
      return true;
    },
    join: async (token) => {
      seen.joins.push(token);
      return JOINED;
    },
    notify: async (notice) => {
      seen.notices.push(notice);
    },
    joined: (playlistId) => seen.joined.push(playlistId),
    ...over,
  };
  return { ports, seen };
};

test("signed in, the invite shows its join screen and Join joins with the token", async () => {
  const { ports, seen } = phone();
  await openInvite(TOKEN, ports);
  assert.deepEqual(seen.lookUps, [TOKEN]);
  assert.equal(seen.views[0]?.invitedBy, "Leo Perez invited you to");
  assert.equal(seen.views[0]?.joiningAs, "You join as Ana Souza");
  assert.deepEqual(seen.joins, [TOKEN]);
  assert.deepEqual(seen.joined, ["list"]);
  assert.deepEqual(seen.notices, []);
});

test("Cancel joins nothing and says nothing", async () => {
  const { ports, seen } = phone({ askJoin: async () => false });
  await openInvite(TOKEN, ports);
  assert.deepEqual(seen.joins, []);
  assert.deepEqual(seen.joined, []);
  assert.deepEqual(seen.notices, []);
});

test("with the switch off, it asks to update Wave and asks the service nothing", async () => {
  const { ports, seen } = phone({ switchOn: () => false });
  await openInvite(TOKEN, ports);
  assert.deepEqual(seen.notices, [
    {
      title: "Update Wave to join",
      message:
        "This version of Wave can't open invite links yet. Update it, then tap the link again.",
    },
  ]);
  assert.deepEqual(seen.lookUps, []);
  assert.deepEqual(seen.joins, []);
});

test("signed out, it asks to sign in, then opens the invite again", async () => {
  let session: WaveSession = { status: "signedOut" };
  const { ports, seen } = phone({
    session: async () => session,
    signIn: async () => {
      session = ANA;
      return { type: "signedIn" };
    },
  });
  await openInvite(TOKEN, ports);
  assert.equal(seen.signInPrompts, 1);
  assert.deepEqual(seen.lookUps, [TOKEN]);
  assert.deepEqual(seen.joined, ["list"]);
});

test("signed out, turning the prompt or Google's picker down does nothing more", async () => {
  for (const over of [
    { askSignIn: async () => false },
    { signIn: async (): Promise<InviteSignIn> => ({ type: "cancelled" }) },
  ]) {
    const { ports, seen } = phone({ session: async () => ({ status: "signedOut" }), ...over });
    await openInvite(TOKEN, ports);
    assert.deepEqual(seen.lookUps, []);
    assert.deepEqual(seen.notices, []);
  }
});

test("a service that can admit no new account says it is full", async () => {
  const { ports, seen } = phone({
    session: async () => ({ status: "signedOut" }),
    signIn: async () => ({ type: "failed", reason: "accountsFull" }),
  });
  await openInvite(TOKEN, ports);
  assert.equal(seen.notices[0]?.title, "The service is full");
  assert.deepEqual(seen.lookUps, []);
});

test("a link no longer valid says so and shows no join screen", async () => {
  const { ports, seen } = phone({
    lookUp: async () => ({ type: "refused", refusal: "linkNotValid" }),
  });
  await openInvite(TOKEN, ports);
  assert.equal(seen.notices[0]?.title, "This invite is no longer valid");
  assert.deepEqual(seen.views, []);
  assert.deepEqual(seen.joins, []);
});

test("a refused Join says why and leaves no joined playlist", async () => {
  const { ports, seen } = phone({
    join: async () => ({ type: "refused", refusal: "linkNotValid" }),
  });
  await openInvite(TOKEN, ports);
  assert.equal(seen.notices[0]?.title, "This invite is no longer valid");
  assert.deepEqual(seen.joined, []);
});
