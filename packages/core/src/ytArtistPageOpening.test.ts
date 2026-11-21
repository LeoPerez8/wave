import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ytArtistPageOpening,
  ytArtistPageView,
  ytArtistPageWaiting,
  YT_ARTIST_SECTION_START,
} from "./index.ts";

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

const justice = { name: "Justice", browseId: "UCjustice", audience: null };
const seen = (checkedAt: number) => ({
  status: "ready" as const,
  failure: null,
  saved: {
    outcome: "found" as const,
    checkedAt,
    browseId: "artist",
    page: { name: "Air", songs: [], allSongs: [], albums: [], singles: [], similar: [justice] },
  },
});

test("offline, a page seen before still shows its similar artists with the offline line", () => {
  const YEAR = 365 * 24 * 60 * 60 * 1000;
  for (const state of [seen(1000), seen(1000 - YEAR)]) {
    const { view, finder } = ytArtistPageOpening(state, { ...context, settled: true });
    assert.equal(view.note, "offline");
    assert.deepEqual(view.songs, []);
    assert.deepEqual(view.similar, [justice]);
    assert.equal(finder, false);
  }
});

test("offline with nothing kept, or with YT Music off, no similar artists show", () => {
  const nothing = { status: "ready" as const, saved: null, failure: null };
  assert.deepEqual(ytArtistPageOpening(nothing, context).view.similar, []);
  assert.deepEqual(ytArtistPageOpening(YT_ARTIST_SECTION_START, context).view.similar, []);
  assert.deepEqual(
    ytArtistPageOpening(seen(1000), { ...context, enabled: false }).view.similar,
    [],
  );
});

test("a saved page's similar artists wait with its songs for settled Library matching", () => {
  const first = ytArtistPageOpening(seen(1000), { ...context, online: true });
  assert.equal(first.view.note, "loading");
  assert.deepEqual(first.view.similar, []);
  const settled = ytArtistPageOpening(seen(1000), { ...context, online: true, settled: true });
  assert.deepEqual(settled.view.similar, [justice]);
});

const about = { description: "French electronic duo.", subscribers: "1.2M", views: null };
const seenWithAbout = (checkedAt: number) => {
  const state = seen(checkedAt);
  return {
    ...state,
    saved: {
      ...state.saved,
      page: { ...state.saved.page, description: about.description, subscribers: "1.2M" },
    },
  };
};

test("offline, a page seen before still shows its About, however old it is", () => {
  const YEAR = 365 * 24 * 60 * 60 * 1000;
  for (const state of [seenWithAbout(1000), seenWithAbout(1000 - YEAR)]) {
    const { view } = ytArtistPageOpening(state, { ...context, settled: true });
    assert.equal(view.note, "offline");
    assert.deepEqual(view.about, about);
  }
});

test("offline with nothing kept, or with YT Music off, no About shows", () => {
  const nothing = { status: "ready" as const, saved: null, failure: null };
  assert.equal(ytArtistPageOpening(nothing, context).view.about, null);
  assert.equal(ytArtistPageOpening(seen(1000), context).view.about, null);
  assert.equal(
    ytArtistPageOpening(seenWithAbout(1000), { ...context, enabled: false }).view.about,
    null,
  );
});

test("a saved page's About waits with its songs for settled Library matching", () => {
  const first = ytArtistPageOpening(seenWithAbout(1000), { ...context, online: true });
  assert.equal(first.view.note, "loading");
  assert.equal(first.view.about, null);
  const settled = ytArtistPageOpening(seenWithAbout(1000), {
    ...context,
    online: true,
    settled: true,
  });
  assert.deepEqual(settled.view.about, about);
});

test("a page waiting for Library matching shows only its name over the loading rows", () => {
  const found = ytArtistPageView(seenWithAbout(1000), context);
  assert.deepEqual(found.about, about);
  assert.deepEqual(ytArtistPageWaiting(found), {
    name: "Air",
    artworkUrl: null,
    songs: [],
    shelves: [],
    similar: [],
    about: null,
    note: "loading",
    retry: false,
  });
});
