import assert from "node:assert/strict";
import { test } from "node:test";
import type { SecretBox, SessionFiles } from "../account/sessionStore.ts";
import { createYtSessions, ytSessionStore } from "./ytSessionStore.ts";

/** A keyring that "encrypts" by reversing, so a test can tell the stored bytes aren't plain. */
const keyring = (backend = "gnome_libsecret"): SecretBox => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => backend,
  encryptString: (text) => Buffer.from([...Buffer.from(text, "utf8")].reverse()),
  decryptString: (bytes) => Buffer.from([...bytes].reverse()).toString("utf8"),
});

const disk = () => {
  const files = new Map<string, Buffer>();
  const io: SessionFiles = {
    read: (path) => files.get(path),
    write: (path, bytes) => void files.set(path, Buffer.from(bytes)),
    remove: (path) => void files.delete(path),
  };
  return { files, io };
};

const ACCOUNT = { name: "Ana", email: "ana@example.com", photoUrl: null };
// A made-up cookie under the names YouTube's have: no account's.
const SIGNED_IN = {
  cookie: "SAPISID=fake-value; SID=fake-other",
  dataSyncId: "111",
  authUser: "0",
  account: ACCOUNT,
};

const sessions = (box: SecretBox, io: SessionFiles, platform: NodeJS.Platform = "linux") =>
  createYtSessions(ytSessionStore({ box, file: "yt-session.bin", files: io, platform }));

test("the session the JVM hands over is sealed, and handed back when the JVM starts again", async () => {
  const { files, io } = disk();
  const first = sessions(keyring(), io);
  assert.deepEqual(await first.host["ytSession.load"]!({}), { session: null });
  assert.equal(await first.host["ytSession.save"]!({ session: SIGNED_IN }), null);
  const bytes = files.get("yt-session.bin");
  assert.ok(bytes);
  assert.ok(!bytes.toString("utf8").includes("fake-value"), "the cookie isn't written as text");
  assert.ok(!bytes.toString("utf8").includes("SAPISID"));
  const afterRestart = sessions(keyring(), io);
  assert.deepEqual(await afterRestart.host["ytSession.load"]!({}), { session: SIGNED_IN });
  assert.deepEqual(afterRestart.session(), { status: "signedIn", account: ACCOUNT });
});

for (const [why, box] of [
  ["no Secret Service (basic_text)", keyring("basic_text")],
  ["no backend found", keyring("unknown")],
  ["no encryption at all", { ...keyring(), isEncryptionAvailable: () => false }],
] as const)
  test(`with ${why} on Linux, the session lasts until Wave quits and nothing is written`, async () => {
    const { files, io } = disk();
    const running = sessions(box, io);
    assert.equal(running.keyringMissing(), true);
    await running.host["ytSession.save"]!({ session: SIGNED_IN });
    assert.equal(files.size, 0);
    assert.deepEqual(await running.host["ytSession.load"]!({}), { session: SIGNED_IN });
    assert.deepEqual(await sessions(box, io).host["ytSession.load"]!({}), { session: null });
  });

test("a session YouTube ended is kept without its cookie, and says who it was", async () => {
  const { io } = disk();
  const kept = sessions(keyring(), io);
  await kept.host["ytSession.save"]!({ session: { expired: true, account: ACCOUNT } });
  assert.deepEqual(kept.session(), { status: "expired", account: ACCOUNT });
  await kept.host["ytSession.save"]!({ session: { expired: true, account: null } });
  assert.deepEqual(kept.session(), { status: "expired", account: null });
});

test("signing out deletes the file, and whoever listens hears each change", async () => {
  const { files, io } = disk();
  const kept = sessions(keyring(), io);
  const heard: string[] = [];
  kept.subscribe((session) => heard.push(session.status));
  await kept.host["ytSession.save"]!({ session: SIGNED_IN });
  await kept.host["ytSession.save"]!({ session: null });
  assert.equal(files.size, 0);
  assert.deepEqual(kept.session(), { status: "signedOut" });
  assert.deepEqual(heard, ["signedIn", "signedOut"]);
});

test("what isn't a session is refused, and a file that isn't one reads as signed out", async () => {
  const { files, io } = disk();
  const kept = sessions(keyring(), io);
  await assert.rejects(kept.host["ytSession.save"]!({ session: { cookie: 1 } }));
  await assert.rejects(kept.host["ytSession.save"]!({ session: "SAPISID=fake" }));
  assert.equal(files.size, 0);
  files.set("yt-session.bin", Buffer.from("not sealed by this keyring"));
  assert.deepEqual(await kept.host["ytSession.load"]!({}), { session: null });
  assert.deepEqual(kept.session(), { status: "signedOut" });
});
