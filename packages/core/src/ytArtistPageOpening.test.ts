import assert from "node:assert/strict";
import { test } from "node:test";
import { ytArtistPageOpening, YT_ARTIST_SECTION_START } from "./index.ts";

const context = {
  enabled: true,
  now: 1000,
  settled: false,
  online: false,
  librarySong: () => null,
  libraryAlbum: () => null,
};
test("a named YT artist shows offline before restoration, settlement or a Library finder", () => {
  const work = ytArtistPageOpening(YT_ARTIST_SECTION_START, context);
  assert.equal(work.view.note, "offline");
  assert.equal(work.ask, false);
  assert.equal(work.finder, false);
});

test("remote artist asks and retries wait for settlement, connectivity and the Settings switch", () => {
  const ready = { status: "ready" as const, saved: null, failure: null };
  assert.equal(ytArtistPageOpening(ready, { ...context, online: true }).ask, false);
  assert.equal(ytArtistPageOpening(ready, { ...context, online: true, settled: true }).ask, true);
  const failed = { ...ready, failure: "failed" as const };
  assert.equal(ytArtistPageOpening(failed, { ...context, online: true, settled: true }).ask, false);
  assert.equal(
    ytArtistPageOpening(failed, { ...context, online: true, settled: true, retry: true }).ask,
    true,
  );
  assert.equal(ytArtistPageOpening(failed, { ...context, settled: true, retry: true }).ask, false);
  assert.equal(
    ytArtistPageOpening(failed, {
      ...context,
      online: true,
      settled: true,
      retry: true,
      enabled: false,
    }).view.note,
    "off",
  );
});

test("a saved online page waits for settled Library matching before its songs appear", () => {
  const state = {
    status: "ready" as const,
    failure: null,
    saved: {
      outcome: "found" as const,
      checkedAt: 1000,
      browseId: "artist",
      page: { name: "Justice", songs: [], allSongs: [], albums: [], singles: [] },
    },
  };
  const first = ytArtistPageOpening(state, { ...context, online: true });
  assert.equal(first.finder, false);
  assert.equal(first.view.note, "loading");
  assert.equal(
    ytArtistPageOpening(state, { ...context, online: true, settled: true }).finder,
    true,
  );
});
