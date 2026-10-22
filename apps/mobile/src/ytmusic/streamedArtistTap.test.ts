import assert from "node:assert/strict";
import test from "node:test";
import { followStreamedArtistTap } from "./streamedArtistTap.ts";

test("resolved artist actions dispatch during the gesture, without waiting for a lookup", async () => {
  const opened: unknown[] = [];
  const action = followStreamedArtistTap(
    { kind: "open", target: { kind: "library", artist: { id: 3, name: "Björk" } } },
    {
      resolve: async () => assert.fail("known artist must open immediately"),
      deliver: (link) => opened.push(link),
    },
  );
  assert.deepEqual(opened, [
    { kind: "open", target: { kind: "library", artist: { id: 3, name: "Björk" } } },
  ]);
  await action;
});
