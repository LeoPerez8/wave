import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";

import { checkArtistShows, type TicketmasterPath } from "./showsCheck.ts";

const attraction = {
  _embedded: {
    attractions: [{ id: "K1", name: "Aurora", classifications: [{ segment: { name: "Music" } }] }],
  },
};
const event = (id: string) => ({
  id,
  url: `https://tickets.example/${id}`,
  dates: { start: { dateTime: "2099-05-01T20:00:00Z" } },
  _embedded: {
    venues: [{ name: "Hall", city: { name: "São Paulo" }, country: { countryCode: "BR" } }],
  },
});
/** Ticketmaster as the check sees it: every call it makes, in order. */
const ticketmaster = (events: unknown) => {
  const calls: TicketmasterPath[] = [];
  const kept: string[] = [];
  return {
    calls,
    kept,
    request: (path: TicketmasterPath) =>
      Effect.sync(() => {
        calls.push(path);
        return path === "attractions" ? attraction : events;
      }),
    keepAttraction: (id: string) => Effect.sync(() => void kept.push(id)),
  };
};
const aurora = { key: "aurora", name: "Aurora" };
const manyPages = { _embedded: { events: [event("e1")] }, page: { totalPages: 5 } };

test("a first check costs two calls and keeps the attraction id before reading shows", async () => {
  const tm = ticketmaster(manyPages);
  const found = await Effect.runPromise(
    checkArtistShows({ ...aurora, attractionId: null }, "BR", tm),
  );
  assert.deepEqual(tm.calls, ["attractions", "events"]);
  assert.deepEqual(tm.kept, ["K1"]);
  assert.equal(found?.attractionId, "K1");
  assert.deepEqual(
    found?.shows.map((s) => s.id),
    ["e1"],
  );
});

test("a kept attraction id costs one call, even when Ticketmaster has more pages", async () => {
  const tm = ticketmaster(manyPages);
  const found = await Effect.runPromise(
    checkArtistShows({ ...aurora, attractionId: "K1" }, "BR", tm),
  );
  assert.deepEqual(tm.calls, ["events"]);
  assert.deepEqual(tm.kept, []);
  assert.equal(found?.shows.length, 1);
});

test("no matching attraction or an unreadable answer saves nothing", async () => {
  const missing = {
    ...ticketmaster(manyPages),
    request: (path: TicketmasterPath) =>
      Effect.succeed(path === "attractions" ? { page: { totalElements: 0 } } : manyPages),
  };
  assert.equal(
    await Effect.runPromise(checkArtistShows({ ...aurora, attractionId: null }, "BR", missing)),
    null,
  );
  const garbled = ticketmaster({ nope: true });
  assert.equal(
    await Effect.runPromise(checkArtistShows({ ...aurora, attractionId: "K1" }, "BR", garbled)),
    null,
  );
});

test("a refused request (offline, switched off) stops the check without asking again", async () => {
  const calls: TicketmasterPath[] = [];
  const offline = {
    request: (path: TicketmasterPath) =>
      Effect.suspend(() => {
        calls.push(path);
        return Effect.fail(new Error("Offline"));
      }),
    keepAttraction: () => Effect.void,
  };
  const exit = await Effect.runPromiseExit(
    checkArtistShows({ ...aurora, attractionId: null }, "BR", offline),
  );
  assert.equal(exit._tag, "Failure");
  assert.deepEqual(calls, ["attractions"]);
});
