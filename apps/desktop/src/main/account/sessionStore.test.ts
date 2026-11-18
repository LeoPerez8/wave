import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionStore, type SecretBox, type SessionFiles } from "./sessionStore.ts";

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

const SIGNED_IN = {
  status: "signedIn",
  token: "session-token",
  serviceUrl: "https://sync.wave.test",
  account: { email: "ana@example.com", name: "Ana", photoUrl: null },
} as const;

test("a session saved with a keyring comes back after a restart, never as plain text", () => {
  const { files, io } = disk();
  const first = sessionStore({ box: keyring(), file: "session.bin", files: io, platform: "linux" });
  assert.equal(first.keyringMissing(), false);
  first.save(SIGNED_IN);
  const bytes = files.get("session.bin");
  assert.ok(bytes);
  assert.ok(!bytes.toString("utf8").includes("session-token"));
  const second = sessionStore({
    box: keyring(),
    file: "session.bin",
    files: io,
    platform: "linux",
  });
  assert.deepEqual(second.load(), SIGNED_IN);
});

test("on Windows, DPAPI is the keyring", () => {
  const { io } = disk();
  const store = sessionStore({ box: keyring("unknown"), file: "s", files: io, platform: "win32" });
  assert.equal(store.keyringMissing(), false);
});

for (const [why, box] of [
  ["no Secret Service (basic_text)", keyring("basic_text")],
  ["no backend found", keyring("unknown")],
  ["no encryption at all", { ...keyring(), isEncryptionAvailable: () => false }],
] as const)
  test(`with ${why} on Linux, the session lives in memory and nothing is written`, () => {
    const { files, io } = disk();
    const store = sessionStore({ box, file: "session.bin", files: io, platform: "linux" });
    assert.equal(store.keyringMissing(), true);
    store.save(SIGNED_IN);
    assert.deepEqual(store.load(), SIGNED_IN);
    assert.equal(files.size, 0);
    const restarted = sessionStore({ box, file: "session.bin", files: io, platform: "linux" });
    assert.equal(restarted.load(), null);
  });

test("signing out removes the stored session", () => {
  const { files, io } = disk();
  const store = sessionStore({ box: keyring(), file: "session.bin", files: io, platform: "linux" });
  store.save(SIGNED_IN);
  store.clear();
  assert.equal(store.load(), null);
  assert.equal(files.size, 0);
});

test("a file that doesn't decrypt or parse is no session", () => {
  const { files, io } = disk();
  files.set("session.bin", Buffer.from("garbage"));
  const store = sessionStore({ box: keyring(), file: "session.bin", files: io, platform: "linux" });
  assert.equal(store.load(), null);
});
