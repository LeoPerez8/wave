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

import {
  openInvite,
  openWhenJoined,
  type InviteRunnerPorts,
  type InviteSignIn,
  type JoinedOpenPorts,
} from "./inviteJoinRunner.ts";

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

/** A phone with Ana signed in, who taps Join; [over] changes any of it. */
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

/** Ports for `openWhenJoined`: the device has the playlist once [has] holds an id. */
const joinedPorts = (has: { id: number | null }) => {
  const seen = { opened: [] as number[], listening: 0, timers: 0 };
  let changed: (() => void) | null = null;
  let timeUp: (() => void) | null = null;
  const ports: JoinedOpenPorts = {
    find: async () => has.id,
    onPlaylistsEdited: (listener) => {
      changed = listener;
      seen.listening += 1;
      return () => {
        seen.listening -= 1;
      };
    },
    open: (id) => seen.opened.push(id),
    after: (_ms, done) => {
      timeUp = done;
      seen.timers += 1;
      return () => {
        seen.timers -= 1;
      };
    },
  };
  return { ports, seen, edit: () => changed?.(), timeUp: () => timeUp?.() };
};

/** Lets the promises already resolved run their callbacks. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("after Join, a playlist the device already has opens at once", async () => {
  const { ports, seen } = joinedPorts({ id: 7 });
  openWhenJoined(ports, 60_000);
  await settled();
  assert.deepEqual(seen.opened, [7]);
  assert.equal(seen.listening, 0);
  assert.equal(seen.timers, 0);
});

test("after Join, the playlist opens when a change brings it, and only once", async () => {
  const has: { id: number | null } = { id: null };
  const { ports, seen, edit } = joinedPorts(has);
  openWhenJoined(ports, 60_000);
  await settled();
  assert.deepEqual(seen.opened, []);
  has.id = 4;
  edit();
  edit();
  await settled();
  assert.deepEqual(seen.opened, [4]);
  assert.equal(seen.listening, 0);
});

test("after Join, nothing opens once the wait is over", async () => {
  const has: { id: number | null } = { id: null };
  const { ports, seen, edit, timeUp } = joinedPorts(has);
  openWhenJoined(ports, 60_000);
  await settled();
  timeUp();
  has.id = 4;
  edit();
  await settled();
  assert.deepEqual(seen.opened, []);
  assert.equal(seen.listening, 0);
});
