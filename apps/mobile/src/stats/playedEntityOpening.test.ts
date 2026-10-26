import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPlayedArtistImage, openPlayedRelease } from "./playedEntityOpening.ts";

test("artist images wait for a visible settled online screen with YT Music on", async () => {
  const state = { enabled: true, settled: true, visible: true, online: true };
  let requests = 0;
  const load = () =>
    loadPlayedArtistImage(
      "A",
      {
        enabled: () => state.enabled,
        settled: () => state.settled,
        visible: () => state.visible,
        online: () => state.online,
      },
      async () => {
        requests++;
        return [{ name: "A", browseId: "a", audience: 1, artworkUrl: "photo" }];
      },
    );
  for (const key of ["enabled", "settled", "visible", "online"] as const) {
    state[key] = false;
    assert.equal(await load(), null);
    state[key] = true;
  }
  assert.equal(requests, 0);
  assert.equal(await load(), "photo");
  assert.equal(requests, 1);
});

test("an album tap makes no request with YT Music off and cannot open after it is disabled", async () => {
  const album = { title: "Album", artists: ["A"], albumId: null };
  let enabled = false;
  let requests = 0;
  const opened: string[] = [];
  const search = async () => {
    requests++;
    enabled = false;
    return [{ title: "Album", artists: ["A"], browseId: "album" }];
  };
  const open = (id: string) => {
    opened.push(id);
  };
  await openPlayedRelease(album, () => enabled, search, open);
  assert.equal(requests, 0);
  enabled = true;
  await openPlayedRelease(album, () => enabled, search, open);
  assert.equal(requests, 1);
  assert.deepEqual(opened, []);
});
