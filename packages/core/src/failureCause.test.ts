import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  describeLogArgs,
  downloadTagWriteOrigin,
  failureCause,
  formatLogEntry,
  lookupFailureLine,
  tagWriteFailureLine,
} from "./index.ts";

/** An error shaped as Effect's `Data.TaggedError` / `Cause.UnknownError` are: a `_tag`, a `cause`. */
const tagged = (tag: string, cause: unknown, message = ""): Error => {
  const error = new Error(message);
  return Object.assign(error, { name: tag, _tag: tag, cause });
};

/** A rejection from an Expo native module, as React Native hands it to JS. */
const expoRejection = (inner: string, code = "ERR_UNEXPECTED"): Error =>
  Object.assign(
    new Error(
      `Call to function 'WaveNative.writeLyricsAndGenre' has been rejected.\n→ Caused by: ${inner}`,
    ),
    { code },
  );

describe("failureCause", () => {
  test("finds the native exception under a TaggedError wrapping an UnknownError", () => {
    const native = expoRejection(
      "org.jaudiotagger.audio.exceptions.CannotWriteException: Unable to make changes to this file",
    );
    const error = tagged(
      "TagWriteFailed",
      tagged("UnknownError", native, "An error occurred in Effect.tryPromise"),
    );
    assert.deepEqual(failureCause(error), {
      kind: "org.jaudiotagger.audio.exceptions.CannotWriteException",
      message: "Unable to make changes to this file",
      httpStatus: null,
    });
  });
});

/** A failed request's error as Fix Song throws it: its status, and the URL in its message. */
const httpError = (status: number, url: string): Error =>
  Object.assign(new Error(`HTTP ${status} for ${url}`), { name: "HttpStatusError", status });

describe("lookupFailureLine", () => {
  test("names the service, the HTTP status and the original error, not Effect's wrapper", () => {
    const error = tagged(
      "UnknownError",
      httpError(503, "https://api.deezer.com/search?q=Song"),
      "An error occurred in Effect.tryPromise",
    );
    assert.equal(
      lookupFailureLine("Fix Song lookup", "Deezer", error),
      "Fix Song lookup failed (Deezer, HTTP 503): HttpStatusError: HTTP 503 for https://api.deezer.com/search?q=Song",
    );
  });

  test("a network error under LookupFailed: the service and the error's message", () => {
    const error = tagged("LookupFailed", new TypeError("Network request failed"));
    assert.equal(
      lookupFailureLine("lyrics search", "LRCLIB", error),
      "lyrics search failed (LRCLIB): TypeError: Network request failed",
    );
  });

  test("a timeout is the original error when nothing is under it", () => {
    const timeout = Object.assign(new Error("Operation timed out after '30s'"), {
      name: "TimeoutError",
      _tag: "TimeoutError",
    });
    assert.equal(
      lookupFailureLine("lyrics search", "LRCLIB", tagged("LookupFailed", timeout)),
      "lyrics search failed (LRCLIB): TimeoutError: Operation timed out after '30s'",
    );
  });

  test("a bare reason under the wrapper is said as it is", () => {
    assert.equal(
      lookupFailureLine("lyrics search", "YT Music", tagged("LookupFailed", "No lyrics page")),
      "lyrics search failed (YT Music): No lyrics page",
    );
  });
});

/** A native write failure as JS gets it: the Java exception's class as its name. */
const nativeError = (kind: string, message: string): Error =>
  Object.assign(new Error(message), { name: kind });

describe("tagWriteFailureLine", () => {
  test("a write failing natively on a replacement copy: step, file, origin and exception", () => {
    assert.equal(
      tagWriteFailureLine({
        path: "/storage/emulated/0/Music/Artist/Song.m4a",
        origin: "downgrade",
        step: "write",
        file: { exists: true, bytes: 4_123_456 },
        cause: tagged(
          "TagWriteFailed",
          nativeError(
            "org.jaudiotagger.audio.exceptions.CannotWriteException",
            "incorrect offsets written",
          ),
        ),
      }),
      "couldn't fill in /storage/emulated/0/Music/Artist/Song.m4a: writing the tags failed" +
        " (a quality replacement, downgrade; file present, 4123456 bytes, .m4a):" +
        " org.jaudiotagger.audio.exceptions.CannotWriteException: incorrect offsets written",
    );
  });

  test("reading a missing file in a Fix Song run", () => {
    assert.equal(
      tagWriteFailureLine({
        path: "/Music/Song.mp3",
        origin: "fixSong",
        step: "read",
        file: { exists: false, bytes: null },
        cause: nativeError("java.io.FileNotFoundException", "/Music/Song.mp3"),
      }),
      "couldn't fill in /Music/Song.mp3: reading the file failed" +
        " (a Fix Song run; file missing, .mp3): java.io.FileNotFoundException: /Music/Song.mp3",
    );
  });

  test("a rejection with no step or file facts still says the origin, extension and cause", () => {
    assert.equal(
      tagWriteFailureLine({
        path: "/Music/Song",
        origin: "download",
        step: null,
        file: null,
        cause: tagged(
          "TagWriteFailed",
          tagged(
            "UnknownError",
            expoRejection("java.lang.IllegalStateException: closed"),
            "An error occurred in Effect.tryPromise",
          ),
        ),
      }),
      "couldn't fill in /Music/Song: the write failed (a download; no extension):" +
        " java.lang.IllegalStateException: closed",
    );
  });

  test("re-indexing after the Lyrics view's search, and an upgrade's origin", () => {
    const line = tagWriteFailureLine({
      path: "/Music/Song.flac",
      origin: "lyricsSearch",
      step: "reindex",
      file: { exists: true, bytes: 10 },
      cause: new Error("database is locked"),
    });
    assert.equal(
      line,
      "couldn't write the lyrics found into /Music/Song.flac: re-indexing failed" +
        " (the Lyrics view's search; file present, 10 bytes, .flac): Error: database is locked",
    );
    assert.match(
      tagWriteFailureLine({
        path: "/a.mp3",
        origin: "upgrade",
        step: null,
        file: null,
        cause: "x",
      }),
      /\(a quality replacement, upgrade; \.mp3\)/,
    );
  });
});

describe("failure lines in the log", () => {
  test("stay redacted and short however long the cause's message is", () => {
    const cause = tagged(
      "LookupFailed",
      new Error(`Cookie: SAPISID=secret123 ${"x".repeat(20_000)}`),
    );
    const message = describeLogArgs([
      `[wave] ${lookupFailureLine("lyrics search", "LRCLIB", cause)}`,
    ]);
    const entry = formatLogEntry({ at: 0, level: "warn", tag: "console", message });
    assert.ok(!entry.includes("secret123"));
    assert.ok(entry.includes("lyrics search failed (LRCLIB): Error: Cookie: [redacted]"));
    assert.ok(message.length <= 1_100);
  });
});

describe("downloadTagWriteOrigin", () => {
  test("a quality replacement's job says which way; any other download is a download", () => {
    assert.equal(downloadTagWriteOrigin("upgrade:12"), "upgrade");
    assert.equal(downloadTagWriteOrigin("downgrade:3"), "downgrade");
    assert.equal(downloadTagWriteOrigin("missing:4"), "download");
    assert.equal(downloadTagWriteOrigin("videoId123"), "download");
  });
});
