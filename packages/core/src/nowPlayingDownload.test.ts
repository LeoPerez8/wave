import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { nowPlayingDownload } from "./index.ts";

describe("Now Playing's Download button", () => {
  test("a song with a file in the Library has none", () => {
    assert.equal(nowPlayingDownload(null, { hasFile: true }), null);
  });

  test("a streamed song not on its way offers Download", () => {
    assert.deepEqual(nowPlayingDownload(null, { hasFile: false }), { kind: "download" });
  });

  test("a download waiting its turn shows waiting", () => {
    assert.deepEqual(nowPlayingDownload({ kind: "queued" }, { hasFile: false }), {
      kind: "waiting",
    });
  });

  test("a download receiving the file shows how much has arrived", () => {
    assert.deepEqual(
      nowPlayingDownload(
        { kind: "downloading", received: 250, total: 1000, phase: "transferring" },
        { hasFile: false },
      ),
      { kind: "progress", fraction: 0.25 },
    );
  });

  test("a download being saved to the Library shows a full ring", () => {
    assert.deepEqual(nowPlayingDownload({ kind: "saving" }, { hasFile: false }), {
      kind: "progress",
      fraction: 1,
    });
  });

  test("a failed download shows failed", () => {
    assert.deepEqual(
      nowPlayingDownload({ kind: "failed", reason: "offline" }, { hasFile: false }),
      { kind: "failed" },
    );
  });

  test("a finished download hides it while the Library catches up", () => {
    assert.equal(
      nowPlayingDownload({ kind: "done", path: "/music/a.m4a" }, { hasFile: false }),
      null,
    );
  });
});
