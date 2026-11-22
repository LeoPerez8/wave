import assert from "node:assert/strict";
import { test } from "node:test";

import type { ArtistOpeningContext } from "./artistOpeningRead.ts";
import { createArtistVisits } from "./artistVisit.ts";

const CONTEXT: ArtistOpeningContext = {
  enabled: true,
  settled: true,
  contentReady: true,
  integrated: false,
  always: false,
  pick: null,
};

/** A reader that records what the visit asks of it. */
const fakeReader = (visible: () => boolean) => {
  const calls: string[] = [];
  const updates: ArtistOpeningContext[] = [];
  return {
    calls,
    updates,
    visible,
    open: (name: string) => calls.push(`open ${name}`),
    close: () => calls.push("close"),
    update: (context: ArtistOpeningContext) => updates.push(context),
  };
};

test("the artist page and its Songs screen share one reader, opened once and closed by the last", () => {
  const visits = createArtistVisits<ReturnType<typeof fakeReader>>();
  const page = visits.visit("air", fakeReader);
  const releasePage = page.hold("Air", () => false);
  const songs = visits.visit("air", fakeReader);
  assert.equal(songs, page);
  const releaseSongs = songs.hold("Air", () => true);
  assert.deepEqual(page.reader.calls, ["open Air"]);
  releaseSongs();
  assert.deepEqual(page.reader.calls, ["open Air"]);
  releasePage();
  assert.deepEqual(page.reader.calls, ["open Air", "close"]);
});

test("the read sees the visit while either screen is in sight", () => {
  const visits = createArtistVisits<ReturnType<typeof fakeReader>>();
  const visit = visits.visit("air", fakeReader);
  let pageSeen = true;
  let songsSeen = false;
  visit.hold("Air", () => pageSeen);
  visit.hold("Air", () => songsSeen);
  assert.equal(visit.reader.visible(), true);
  pageSeen = false;
  assert.equal(visit.reader.visible(), false);
  songsSeen = true;
  assert.equal(visit.reader.visible(), true);
});

test("Library | Online picked on either screen is the other's too, and tells the read", () => {
  const visits = createArtistVisits<ReturnType<typeof fakeReader>>();
  const visit = visits.visit("air", fakeReader);
  const heard: string[] = [];
  visit.subscribe(() => heard.push(String(visit.pick())));
  const screen = visit.hold("Air", () => true);
  visit.update(screen, CONTEXT);
  visit.setPick("online");
  assert.equal(visits.visit("air", fakeReader).pick(), "online");
  assert.deepEqual(heard, ["online"]);
  assert.equal(visit.reader.updates.at(-1)?.pick, "online");
});

test("the read gets what any screen of the visit has: one still loading doesn't stop it", () => {
  const visits = createArtistVisits<ReturnType<typeof fakeReader>>();
  const visit = visits.visit("air", fakeReader);
  const page = visit.hold("Air", () => false);
  const songs = visit.hold("Air", () => true);
  visit.update(page, CONTEXT);
  visit.update(songs, { ...CONTEXT, contentReady: false, settled: false });
  const last = visit.reader.updates.at(-1);
  assert.equal(last?.contentReady, true);
  assert.equal(last?.settled, true);
});

test("a screen leaving takes its context out of the read's", () => {
  const visits = createArtistVisits<ReturnType<typeof fakeReader>>();
  const visit = visits.visit("air", fakeReader);
  const page = visit.hold("Air", () => true);
  const songs = visit.hold("Air", () => true);
  visit.update(page, { ...CONTEXT, integrated: true });
  visit.update(songs, CONTEXT);
  page();
  visit.update(songs, CONTEXT);
  assert.equal(visit.reader.updates.at(-1)?.integrated, false);
});

test("the next visit of the artist starts over with nothing picked", () => {
  const visits = createArtistVisits<ReturnType<typeof fakeReader>>();
  const first = visits.visit("air", fakeReader);
  const release = first.hold("Air", () => true);
  first.setPick("online");
  release();
  const next = visits.visit("air", fakeReader);
  assert.equal(next.pick(), null);
  next.hold("Air", () => true);
  assert.equal(next.reader.calls.at(-1), "open Air");
});

test("another artist gets a visit of their own", () => {
  const visits = createArtistVisits<ReturnType<typeof fakeReader>>();
  assert.notEqual(visits.visit("air", fakeReader), visits.visit("justice", fakeReader));
});
