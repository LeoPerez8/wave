import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { describeLogArgs, formatLogEntry, logFileName, logHeader, trimLog } from "./index.ts";

const at = Date.UTC(2026, 9, 16, 14, 3, 22, 415);

/** A warning line with [message]. */
const line = (message: string): string =>
  formatLogEntry({ at, level: "warn", tag: "console", message });

/** The n-th of a run of log entries, with a title outside ASCII. */
const entry = (n: number): string =>
  formatLogEntry({ at: at + n, level: "warn", tag: "console", message: `Beyoncé · entry ${n}` });
const log = (count: number): string => Array.from({ length: count }, (_, n) => entry(n)).join("");
const bytes = (text: string): number => Buffer.byteLength(text, "utf8");

describe("formatLogEntry", () => {
  test("a line starts with the time, the level and the tag", () => {
    assert.equal(
      formatLogEntry({ at, level: "warn", tag: "console", message: "Couldn't start syncing" }),
      "2026-10-16T14:03:22.415Z W console: Couldn't start syncing\n",
    );
  });

  test("a stack's lines follow, indented, so only an entry's first line starts with a time", () => {
    const message =
      "TypeError: boom\nat play (index.bundle:1:2)\r\n    at next (index.bundle:3:4)\n";
    assert.equal(
      formatLogEntry({ at, level: "fatal", tag: "uncaught", message }),
      "2026-10-16T14:03:22.415Z F uncaught: TypeError: boom\n" +
        "  at play (index.bundle:1:2)\n" +
        "      at next (index.bundle:3:4)\n",
    );
  });
});

describe("formatLogEntry redaction", () => {
  const secrets: readonly (readonly [string, string, string])[] = [
    ["a password= pair", "login failed user=leo&password=hunter22&x=1", "hunter22"],
    ["a JSON password", 'Soulseek login {"username":"leo","password":"s3cr3t pass"}', "s3cr3t"],
    ["a printed object's password", "{ username: 'leo', password: 'pw-123' }", "pw-123"],
    ["a bearer header", "GET /v1/pull Authorization: Bearer abc.DEF-123_xyz", "abc.DEF-123_xyz"],
    ["a bare bearer token", "sent bearer QVRfdG9rZW4tMTIz", "QVRfdG9rZW4tMTIz"],
    ["a cookie header", "Cookie: SAPISID=sapi-777; __Secure-3PSID=psid-888", "sapi-777"],
    [
      "a cookie header's later cookies",
      "Cookie: SAPISID=sapi-777; __Secure-3PSID=psid-888",
      "psid-888",
    ],
    ["a set-cookie header", "Set-Cookie: SID=sid-999; Path=/; Secure", "sid-999"],
    ["a token query parameter", "GET https://x.test/a?access_token=tok-111&page=2", "tok-111"],
    ["a JSON token", '{"accessToken":"BQ-spotify-222","expires":3600}', "BQ-spotify-222"],
    ["a session token key", '{"sessionToken":"wave-sess-333"}', "wave-sess-333"],
    ["a proof-of-origin token", "poToken: MnPoTokenValue444", "MnPoTokenValue444"],
    [
      "a JWT (a Google ID token)",
      "signing in with eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl",
      "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl",
    ],
    [
      "a Google access token",
      "using ya29.a0AfH6SM-token_555 for YouTube",
      "ya29.a0AfH6SM-token_555",
    ],
    ["credentials in a URL", "fetch https://leo:hunter22@example.test/x failed", "hunter22"],
  ];

  for (const [shape, message, secret] of secrets) {
    test(`${shape} never appears`, () => {
      const written = line(message);
      assert.ok(!written.includes(secret), written);
      assert.match(written, /\[redacted\]/);
    });
  }

  test("song titles, artists and plain words stay", () => {
    const message =
      'Couldn\'t fill in /Music/twenty one pilots - Heathens.mp3 (Session expired) {"title":"Stressed Out","artist":"twenty one pilots"}';
    assert.equal(line(message), `2026-10-16T14:03:22.415Z W console: ${message}\n`);
  });
});

describe("describeLogArgs", () => {
  test("what console.warn was given, joined by spaces, without Wave's [wave] prefix", () => {
    assert.equal(
      describeLogArgs(["[wave] Couldn't record a preference change", 3, null, undefined, true]),
      "Couldn't record a preference change 3 null undefined true",
    );
  });

  test("an error gives its stack", () => {
    const error = new TypeError("boom");
    error.stack = "TypeError: boom\n    at play (index.bundle:1:2)";
    assert.equal(
      describeLogArgs(["[wave] Auto play failed", error]),
      "Auto play failed TypeError: boom\n    at play (index.bundle:1:2)",
    );
  });

  test("an error without a stack gives its name and message", () => {
    const error = new RangeError("too far");
    delete error.stack;
    assert.equal(describeLogArgs([error]), "RangeError: too far");
  });

  test("an error's cause follows it", () => {
    const cause = new Error("socket closed");
    delete cause.stack;
    const error = new Error("sync failed", { cause });
    delete error.stack;
    assert.equal(describeLogArgs([error]), "Error: sync failed\nCaused by: Error: socket closed");
  });

  test("an error React caught says which components it was in", () => {
    const error = Object.assign(new Error("Text strings must be rendered within a <Text>"), {
      componentStack: "\n    at TrackRow\n    at SongsList",
    });
    delete error.stack;
    assert.equal(
      describeLogArgs([error]),
      "Error: Text strings must be rendered within a <Text>\nComponent stack:\n    at TrackRow\n    at SongsList",
    );
  });

  test("an object is written as JSON", () => {
    assert.equal(
      describeLogArgs(["[wave] YouTube's audio isn't the song's length", { durationMs: 1200 }]),
      `YouTube's audio isn't the song's length {"durationMs":1200}`,
    );
  });

  test("an object that refers to itself is still written", () => {
    const loop: Record<string, unknown> = { name: "loop" };
    loop.self = loop;
    assert.equal(describeLogArgs([loop]), '{"name":"loop","self":"[circular]"}');
  });

  test("a huge message is cut short", () => {
    const message = describeLogArgs(["x".repeat(50_000)]);
    assert.ok(message.length < 10_000, String(message.length));
    assert.match(message, /… \(\d+ more characters\)$/);
  });
});

describe("trimLog", () => {
  test("a log within its cap keeps everything", () => {
    const text = log(10);
    assert.deepEqual(trimLog(text, { maxBytes: bytes(text), keepBytes: 100 }), {
      kept: text,
      droppedBytes: 0,
    });
  });

  test("past its cap, the oldest entries go until the rest fits", () => {
    const text = log(100);
    const size = bytes(text);
    const { kept, droppedBytes } = trimLog(text, { maxBytes: size - 1, keepBytes: size / 2 });
    assert.ok(bytes(kept) <= size / 2);
    assert.ok(kept.endsWith(entry(99)), "the newest entry stays");
    assert.ok(
      kept.startsWith(entry(Number(/entry (\d+)/.exec(kept)?.[1]))),
      "it starts on a whole entry",
    );
    assert.ok(!kept.includes("entry 0\n"), "the oldest went");
    assert.equal(droppedBytes, size - bytes(kept));
    assert.equal(Buffer.from(text, "utf8").subarray(droppedBytes).toString("utf8"), kept);
  });

  test("an entry's stack goes with it", () => {
    const withStack = formatLogEntry({
      at,
      level: "error",
      tag: "uncaught",
      message: `Error: boom\n${"    at frame (index.bundle:1:2)\n".repeat(20)}`,
    });
    const text = withStack + entry(1) + entry(2);
    const keepBytes = bytes(entry(1) + entry(2)) + 40;
    const { kept } = trimLog(text, { maxBytes: bytes(text) - 1, keepBytes });
    assert.equal(kept, entry(1) + entry(2));
  });
});

describe("the exported file", () => {
  const device = {
    appVersion: "0.5.3-ti",
    appBuild: "503",
    androidVersion: "15",
    androidApi: 35,
    manufacturer: "samsung",
    model: "SM-S926B",
    fontScale: 1.2999999523162842,
  };

  test("starts with Wave's version and build, Android's version, the phone and its font scale", () => {
    assert.equal(
      logHeader(device, at),
      [
        "Wave 0.5.3-ti (build 503)",
        "Android 15 (API 35)",
        "Phone: samsung SM-S926B",
        "Font scale: 1.3",
        "Exported: 2026-10-16T14:03:22.415Z",
        "",
        "",
      ].join("\n"),
    );
  });

  test("is a .txt named with the date and Wave's version", () => {
    assert.equal(logFileName("0.5.3-ti", at), "wave-log-2026-10-16-0.5.3-ti.txt");
  });
});
