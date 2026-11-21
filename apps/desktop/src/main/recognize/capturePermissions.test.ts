import assert from "node:assert/strict";
import { test } from "node:test";
import { guardCapture, type PermissionSession } from "./capturePermissions.ts";

type Contents = { readonly name: string };
const WINDOW: Contents = { name: "Wave" };
const OTHER: Contents = { name: "a sign-in page" };
const FRAME = { name: "Wave's page" };

/** A session the guard is installed on, and what Recognize is capturing. */
const guarded = (loopback = true) => {
  const capturing = { microphone: false, systemAudio: false };
  let request!: Parameters<PermissionSession<Contents, string>["setPermissionRequestHandler"]>[0];
  let check!: Parameters<PermissionSession<Contents, string>["setPermissionCheckHandler"]>[0];
  let display!: Parameters<PermissionSession<Contents, string>["setDisplayMediaRequestHandler"]>[0];
  guardCapture<Contents, string>(
    {
      setPermissionRequestHandler: (handler) => void (request = handler),
      setPermissionCheckHandler: (handler) => void (check = handler),
      setDisplayMediaRequestHandler: (handler) => void (display = handler),
    },
    {
      trusted: (contents) => contents === WINDOW,
      trustedFrame: (frame) => frame === FRAME,
      allows: (kind) => capturing[kind],
      screen: async () => "screen:0",
      loopback,
    },
  );
  const asked = (contents: Contents, permission: string, mediaTypes?: string[]) =>
    new Promise<boolean>((resolve) => request(contents, permission, resolve, { mediaTypes }));
  const displayed = (frame: unknown) =>
    new Promise<object>((resolve) => display({ frame }, resolve));
  return { capturing, asked, check, displayed };
};

test("the microphone is Wave's window's only while Recognize captures it", async () => {
  const { capturing, asked, check } = guarded();
  assert.equal(await asked(WINDOW, "media", ["audio"]), false);
  assert.equal(check(WINDOW, "media", "file://", { mediaType: "audio" }), false);
  capturing.microphone = true;
  assert.equal(await asked(WINDOW, "media", ["audio"]), true);
  assert.equal(check(WINDOW, "media", "file://", { mediaType: "audio" }), true);
  assert.equal(await asked(OTHER, "media", ["audio"]), false, "never another page");
  assert.equal(check(null, "media", "file://", { mediaType: "audio" }), false);
});

test("the camera is never allowed, alone or with the microphone", async () => {
  const { capturing, asked, check } = guarded();
  capturing.microphone = true;
  assert.equal(await asked(WINDOW, "media", ["video"]), false);
  assert.equal(await asked(WINDOW, "media", ["audio", "video"]), false);
  assert.equal(await asked(WINDOW, "media", []), false);
  assert.equal(check(WINDOW, "media", "file://", { mediaType: "video" }), false);
});

test("other permissions keep Electron's answer", async () => {
  const { asked, check } = guarded();
  assert.equal(await asked(WINDOW, "fullscreen"), true);
  assert.equal(check(WINDOW, "clipboard-sanitized-write", "file://", {}), true);
});

test("what the computer plays is the screen's loopback audio, only while Recognize captures it", async () => {
  const { capturing, displayed } = guarded();
  assert.deepEqual(await displayed(FRAME), {});
  capturing.systemAudio = true;
  assert.deepEqual(await displayed(FRAME), { video: "screen:0", audio: "loopback" });
  assert.deepEqual(await displayed({ name: "another page" }), {});
  capturing.systemAudio = false;
  capturing.microphone = true;
  assert.deepEqual(await displayed(FRAME), {}, "the microphone's session captures no screen");
});

test("a system without loopback audio captures no screen", async () => {
  const { capturing, displayed } = guarded(false);
  capturing.systemAudio = true;
  assert.deepEqual(await displayed(FRAME), {});
});
