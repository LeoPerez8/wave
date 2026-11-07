import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ticketmasterAttractionsPath,
  ticketmasterEventsPath,
  ticketmasterUpstreamUrl,
} from "./index.ts";

/** What the service asks Ticketmaster for the phone's [path], before it adds its key. */
const upstream = (path: string): string | null => {
  const url = new URL(path, "https://sync.wave.test");
  return ticketmasterUpstreamUrl(url.pathname, url.searchParams);
};

describe("Ticketmaster through the sync service", () => {
  test("each phone request stands for the Ticketmaster request the phone used to send", () => {
    assert.equal(
      ticketmasterAttractionsPath("Coldplay"),
      "/v1/ticketmaster/attractions?keyword=Coldplay",
    );
    assert.equal(
      upstream(ticketmasterAttractionsPath("Coldplay")),
      "https://app.ticketmaster.com/discovery/v2/attractions.json?keyword=Coldplay&classificationName=music&size=200",
    );
    assert.equal(
      upstream(ticketmasterAttractionsPath("Simon & Garfunkel")),
      "https://app.ticketmaster.com/discovery/v2/attractions.json?keyword=Simon%20%26%20Garfunkel&classificationName=music&size=200",
    );
    assert.equal(
      ticketmasterEventsPath("K8vZ917_XCf", "BR"),
      "/v1/ticketmaster/events?attractionId=K8vZ917_XCf&countryCode=BR",
    );
    assert.equal(
      upstream(ticketmasterEventsPath("K8vZ917_XCf", "BR")),
      "https://app.ticketmaster.com/discovery/v2/events.json?attractionId=K8vZ917_XCf&countryCode=BR&sort=date%2Casc&size=200",
    );
  });

  test("an artist's name is only ever the keyword: nothing in it adds a parameter", () => {
    const asked = new URL(
      upstream(ticketmasterAttractionsPath("AC/DC?apikey=x&size=1#y")) ?? "",
    );
    assert.equal(
      asked.origin + asked.pathname,
      "https://app.ticketmaster.com/discovery/v2/attractions.json",
    );
    assert.deepEqual(
      [...asked.searchParams],
      [
        ["keyword", "AC/DC?apikey=x&size=1#y"],
        ["classificationName", "music"],
        ["size", "200"],
      ],
    );
  });

  test("anything else stands for no request", () => {
    for (const path of [
      "/v1/ticketmaster/attractions",
      "/v1/ticketmaster/attractions?keyword=",
      "/v1/ticketmaster/attractions?keyword=%20",
      `/v1/ticketmaster/attractions?keyword=${"a".repeat(501)}`,
      "/v1/ticketmaster/attractions?keyword=a&keyword=b",
      "/v1/ticketmaster/attractions?keyword=a&size=1",
      "/v1/ticketmaster/attractions?keyword=a&apikey=x",
      "/v1/ticketmaster/events",
      "/v1/ticketmaster/events?attractionId=K1",
      "/v1/ticketmaster/events?countryCode=BR",
      "/v1/ticketmaster/events?attractionId=&countryCode=BR",
      "/v1/ticketmaster/events?attractionId=K1&countryCode=br",
      "/v1/ticketmaster/events?attractionId=K1&countryCode=BRA",
      "/v1/ticketmaster/events?attractionId=K1%2F..%2Fvenues&countryCode=BR",
      "/v1/ticketmaster/events?attractionId=K1.json&countryCode=BR",
      `/v1/ticketmaster/events?attractionId=${"K".repeat(65)}&countryCode=BR`,
      "/v1/ticketmaster/events?attractionId=K1&countryCode=BR&size=1",
      "/v1/ticketmaster/events?attractionId=K1&attractionId=K2&countryCode=BR",
      "/v1/ticketmaster/venues?id=1",
      "/v1/ticketmaster/events/K1",
      "/v1/ticketmaster",
      "/v1/genius/search?q=a",
    ]) {
      assert.equal(upstream(path), null, path);
    }
  });
});
