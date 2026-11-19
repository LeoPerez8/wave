import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createDesktopVersionHistory } from "./history.ts";

test("history pages keep the whole channel history available after an oversized response", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wave-desktop-history-"));
  try {
    let calls = 0;
    const releases = Array.from({ length: 80 }, (_, index) => ({
      version: `1.0.${index}`,
      notes: { en: { new: [], fixes: ["A fix"] } },
    }));
    const open = () =>
      createDesktopVersionHistory({
        version: "1.0.0",
        channel: "main",
        folder,
        maxBytes: 16_384,
        fetchHistory: async () => {
          calls++;
          return calls === 1 ? Response.json({ releases }) : new Response("x".repeat(16_385));
        },
      });
    const history = open();
    const first = await history(0, true);
    assert.equal(first.releases?.items[0]?.version, "1.0.79");
    assert.equal(first.releases?.total, 80);
    assert.equal(first.releases?.items.length, 20);
    assert.equal(first.currentListed, true);
    const last = await history(79, false);
    assert.deepEqual(
      last.releases?.items.map((release) => release.version),
      ["1.0.0"],
    );
    assert.equal(calls, 1);
    assert.deepEqual(await open()(79, true), last);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
