import assert from "node:assert/strict";
import { test } from "node:test";
import { ytAlbumOpening, type YtArtistSection } from "./index.ts";

const empty: YtArtistSection = { status: "ready", saved: null, failure: null };
const context = {
  name: "Justice", artistId: 1,
  album: { title: "Cross", albumArtistId: 1 },
  tracks: [], elsewhere: () => null,
  enabled: true, now: 1000, integrated: true,
  releasePage: () => undefined,
  contentReady: true, settled: false, online: true,
};

test("an integrated album starts no request or finder until local content and the screen settle", () => {
  const first = ytAlbumOpening(empty, context);
  assert.equal(first.askArtist, false);
  assert.equal(first.readRelease, null);
  assert.equal(first.finder, false);
  assert.equal(first.view?.tracks, null);
  assert.equal(ytAlbumOpening(empty, { ...context, settled: true }).askArtist, true);
  assert.equal(ytAlbumOpening(empty, { ...context, settled: true, contentReady: false }).askArtist, false);
});
