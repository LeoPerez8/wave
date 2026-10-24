import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMagicSession, startMagicQueue, type MagicSession } from "./index.ts";

/**
 * A Magic Queue from an untagged song by "Obscure Band", an artist YouTube
 * Music doesn't find by name and Deezer doesn't know.
 */
const obscureSeed = (): MagicSession => {
  const started = startMagicQueue(
    { kind: "track", id: "1", title: "Untagged Song" },
    [{ trackId: "1", artists: [], genre: null, style: null }],
    {
      id: "s1",
      random: () => 0,
      radio: { artists: ["Obscure Band"], profile: null, videoIds: ["seedVideo"] },
    },
  );
  assert.ok(started !== null);
  return started.session;
};

test("a Magic Queue keeps its seed songs' video ids through a restart; one saved before reads back without", () => {
  const saved = JSON.parse(JSON.stringify(obscureSeed())) as Record<string, unknown>;
  assert.deepEqual(parseMagicSession(saved)?.seedVideoIds, ["seedVideo"]);
  const { seedVideoIds: _, ...before } = saved;
  assert.deepEqual(parseMagicSession(before)?.seedVideoIds, []);
});
