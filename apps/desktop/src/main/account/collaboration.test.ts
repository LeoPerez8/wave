/**
 * The collaborative playlists' requests from the desktop: the shared client's
 * `collaborationService` over main's `request`, against the sync Worker's harness.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { collaborationService } from "@wave/client/sync/collaborationService";
import type { BrowserSignInPurpose } from "./account.ts";
import { sessionStore, type SessionFiles } from "./sessionStore.ts";
import { DESKTOP_CLIENT, desktop, keyring } from "./testAccount.ts";

const LIST = "5f0c1a2b3c4d5e6f708192a3b4c5d6e7";

/** Ana's desktop and Bea's, on one service; Ana holds the playlist [LIST]. */
const twoDesktops = async () => {
  const app = await desktop();
  const ana = app.open();
  await ana.signIn();
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
  const playlist = { id: LIST, changedAt: 1, phoneId: "desk", deleted: false, name: "Road trip" };
  const pushed = await ana.request(
    "POST",
    "/v1/push",
    JSON.stringify({ playlists: [{ ...playlist, createdAt: 1 }] }),
  );
  assert.equal(pushed.status, 200);
  return { app, ana, bea };
};

test("every collaborative playlist's route can be called from the desktop", async () => {
  const { ana, bea } = await twoDesktops();
  const owner = collaborationService(ana);
  const member = collaborationService(bea);

  assert.deepEqual(await owner.setAccountName("Ana Lima"), { type: "done", value: null });
  const made = await owner.make(LIST);
  assert.equal(made.type, "done");
  assert.equal(made.type === "done" && made.value.members[0]?.name, "Ana Lima");

  const invite = await owner.createInvite(LIST);
  assert.equal(invite.type, "done");
  if (invite.type !== "done") return;
  const token = invite.value.url.split("#")[1]!;
  const active = await owner.readInvite(LIST);
  assert.equal(active.type === "done" && active.value?.expiresAt, invite.value.expiresAt);

  assert.deepEqual(await member.lookUpInvite(token), {
    type: "done",
    value: { playlistId: LIST, playlistName: "Road trip", ownerName: "Ana Lima" },
  });
  const joined = await member.join(token);
  assert.deepEqual(
    joined.type === "done" && joined.value.members.map(({ name, self }) => [name, self]),
    [
      ["Ana Lima", false],
      ["Bea", true],
    ],
  );

  const pulled = await member.pull(LIST, null);
  assert.equal(pulled.type, "done");
  assert.deepEqual(
    pulled.type === "done" &&
      pulled.value.playlists.map((row) => ("name" in row ? row.name : null)),
    ["Road trip"],
  );
  const renamed = JSON.stringify({
    playlists: [
      { id: LIST, changedAt: 2, phoneId: "bea", deleted: false, name: "Trip", createdAt: 1 },
    ],
  });
  assert.equal((await member.push(LIST, renamed)).type, "done");
  const members = await owner.members(LIST);
  assert.equal(members.type === "done" && members.value.members.length, 2);

  assert.deepEqual(await owner.turnOffInvite(LIST), { type: "done", value: null });
  assert.deepEqual(await owner.readInvite(LIST), { type: "done", value: null });
  const beaId = members.type === "done" ? members.value.members[1]!.accountId : "";
  assert.deepEqual(await owner.removeMember(LIST, beaId), { type: "done", value: null });
  assert.deepEqual(await owner.end(LIST), { type: "done", value: null });
});

test("a member leaves, and refusals reach the desktop each as its own", async () => {
  const { ana, bea } = await twoDesktops();
  const owner = collaborationService(ana);
  const member = collaborationService(bea);
  assert.deepEqual(await member.members(LIST), { type: "refused", refusal: "notMember" });
  await owner.make(LIST);
  const invite = await owner.createInvite(LIST);
  const token = invite.type === "done" ? invite.value.url.split("#")[1]! : "";
  await member.join(token);

  assert.deepEqual(await member.end(LIST), { type: "refused", refusal: "notOwner" });
  assert.deepEqual(await owner.leave(LIST), { type: "refused", refusal: "ownerCannotLeave" });
  assert.deepEqual(await member.join("C".repeat(43)), {
    type: "refused",
    refusal: "linkNotValid",
  });
  await owner.createInvite(LIST);
  assert.deepEqual(await member.lookUpInvite(token), {
    type: "refused",
    refusal: "linkNotValid",
  });
  assert.deepEqual(await member.leave(LIST), { type: "done", value: null });
  assert.deepEqual(await member.pull(LIST, null), { type: "refused", refusal: "notMember" });
});

test("offline is told apart from a failure, and nothing goes out signed out", async () => {
  const { app, ana } = await twoDesktops();
  const owner = collaborationService(ana);
  app.offline();
  assert.deepEqual(await owner.members(LIST), { type: "offline" });
  const signedOut = collaborationService(
    app.open({
      store: sessionStore({
        box: keyring,
        file: "none.bin",
        files: { read: () => undefined, write: () => {}, remove: () => {} },
        platform: "win32",
      }),
    }),
  );
  assert.deepEqual(await signedOut.members(LIST), { type: "failed", status: null });
});

test("no session token reaches what a call answers", async () => {
  const { app, ana } = await twoDesktops();
  const owner = collaborationService(ana);
  const { token } = JSON.parse(keyring.decryptString(app.disk.get("session.bin")!)) as {
    token: string;
  };
  assert.equal(token.length, 43);
  const answers = [
    await owner.make(LIST),
    await owner.createInvite(LIST),
    await owner.members(LIST),
    await owner.leave(LIST),
  ];
  assert.ok(!JSON.stringify(answers).includes(token));
});

test("main still refuses a collaboration route with a path it doesn't take", async () => {
  const { ana } = await twoDesktops();
  for (const [method, path] of [
    ["DELETE", "/v1/collaboration?playlist=a/../../account"],
    ["GET", "/v1/collaboration"],
    ["PUT", "/v1/push"],
  ] as const)
    await assert.rejects(ana.request(method, path, null), { code: "ERR_WAVE_FORBIDDEN_REQUEST" });
});
