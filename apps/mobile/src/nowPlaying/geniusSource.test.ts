import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { GENIUS_REFERENTS_PER_PAGE, storedGenius } from "@wave/core";

import { geniusStorageKey, loadGenius, type GeniusService } from "./geniusSource.ts";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../packages/core/src/fixtures/genius/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const ask = {
  key: "library:1",
  song: { title: "Imagine", artist: "John Lennon", album: null, durationMs: 0 },
  token: "test-token",
};

/** A fake phone whose network and switch each test can swap. */
type FakeService = { -readonly [K in keyof GeniusService]: GeniusService[K] };

const phone = () => {
  const storage = new Map<string, string>();
  const requests: string[] = [];
  const service: FakeService = {
    read: async (key) => storage.get(key) ?? null,
    keep: async (key, value) => {
      storage.set(key, value);
    },
    enabled: () => true,
    get: async (url, token) => {
      assert.equal(token, "test-token");
      requests.push(url);
      return fixture(
        url.includes("/search?") ? "search" : url.includes("/referents?") ? "referents-1" : "song",
      );
    },
  };
  return { service, requests, storage };
};

test("a Genius match and About reopen offline for the same song only", async () => {
  const { service, requests } = phone();
  const first = await loadGenius(ask, service, 100);
  assert.equal(first?.match?.id, 10356);
  assert.equal(
    first?.description,
    "A song about imagining a peaceful world.\n\nThis is synthetic fixture text.",
  );
  service.get = async () => {
    throw Error("offline");
  };
  assert.deepEqual(await loadGenius(ask, service, 200), first);
  assert.equal(await loadGenius({ ...ask, key: "track:yt:other" }, service, 200), null);
  assert.equal(requests.length, 3);
});

test("missing token or disabled insights cannot send any Genius request", async () => {
  const { service, requests } = phone();
  assert.equal(await loadGenius({ ...ask, token: "" }, service), null);
  service.enabled = () => false;
  assert.equal(await loadGenius(ask, service), null);
  assert.equal(requests.length, 0);
});

test("misses last a week, failures and malformed replies are retried", async () => {
  const { service, requests, storage } = phone();
  service.get = async (url) => {
    requests.push(url);
    return { meta: { status: 200 }, response: { hits: [] } };
  };
  assert.equal((await loadGenius(ask, service, 100))?.match, null);
  await loadGenius(ask, service, 101);
  assert.equal(requests.length, 1);
  await loadGenius(ask, service, 100 + 7 * 24 * 60 * 60 * 1000);
  assert.equal(requests.length, 2);
  storage.clear();
  service.get = async () => {
    throw Error("offline");
  };
  assert.equal(await loadGenius(ask, service), null);
  assert.equal(storage.size, 0);
  service.get = async () => ({ meta: { status: 429 } });
  assert.equal(await loadGenius(ask, service), null);
  assert.equal(storage.size, 0);
});

test("turning insights off after search prevents the song request and saving", async () => {
  const { service, storage } = phone();
  service.get = async () => {
    service.enabled = () => false;
    return fixture("search");
  };
  assert.equal(await loadGenius(ask, service), null);
  assert.equal(storage.size, 0);
});

test("a matched song without a description keeps its id for later insights", async () => {
  const { service } = phone();
  service.get = async (url) =>
    url.includes("/search?")
      ? fixture("search")
      : { meta: { status: 200 }, response: { song: { id: 10356, description: { plain: "?" } } } };
  const saved = await loadGenius(ask, service, 100);
  assert.equal(saved?.match?.id, 10356);
  assert.equal(saved?.description, null);
});

test("a song whose title changed since is asked about again", async () => {
  const { service, requests } = phone();
  await loadGenius(ask, service, 100);
  await loadGenius({ ...ask, song: { ...ask.song, title: "Imagine (Remastered)" } }, service, 200);
  assert.equal(requests.length, 6);
});

const referentIds = (saved: Awaited<ReturnType<typeof loadGenius>>) =>
  saved?.referents?.map((referent) => referent.id);

test("the song's annotations come with its About and reopen offline", async () => {
  const { service, requests } = phone();
  const first = await loadGenius(ask, service, 100);
  assert.deepEqual(referentIds(first), [2001, 2002, 2003, 2004]);
  assert.ok(
    requests.some((url) => url.includes("/referents?song_id=10356&") && url.endsWith("page=1")),
  );
  service.get = async () => {
    throw Error("offline");
  };
  assert.deepEqual(await loadGenius(ask, service, 200), first);
});

test("every page of Genius's referents is asked until one isn't full", async () => {
  const { service, requests } = phone();
  const get = service.get;
  service.get = async (url, token) => {
    if (!url.includes("/referents?")) return get(url, token);
    requests.push(url);
    if (url.endsWith("page=2")) return fixture("referents-2");
    const page = fixture("referents-1");
    const one = page.response.referents[1];
    page.response.referents = Array.from({ length: GENIUS_REFERENTS_PER_PAGE }, (_, at) => ({
      ...one,
      id: 5000 + at,
    }));
    return page;
  };
  const saved = await loadGenius(ask, service, 100);
  assert.equal(saved?.referents?.length, GENIUS_REFERENTS_PER_PAGE + 3);
  assert.equal(requests.filter((url) => url.includes("/referents?")).length, 2);
});

test("an answer saved before annotations asks only for them, once", async () => {
  const { service, requests, storage } = phone();
  const match = {
    id: 10356,
    title: "Imagine",
    artist: "John Lennon",
    url: "https://genius.com/John-lennon-imagine-lyrics",
  };
  const old = { checkedAt: 100, match, description: "About", referents: null };
  storage.set(geniusStorageKey(ask.key), storedGenius(ask.song, old));
  const saved = await loadGenius(ask, service, 200);
  assert.equal(saved?.description, "About");
  assert.equal(saved?.checkedAt, 100);
  assert.deepEqual(referentIds(saved), [2001, 2002, 2003, 2004]);
  await loadGenius(ask, service, 300);
  assert.deepEqual(
    requests.map((url) => url.includes("/referents?")),
    [true],
  );
});

test("failed annotations keep the About and are asked again next time", async () => {
  const { service, requests } = phone();
  const get = service.get;
  service.get = async (url, token) => {
    if (url.includes("/referents?")) throw Error("offline");
    return get(url, token);
  };
  const first = await loadGenius(ask, service, 100);
  assert.equal(first?.match?.id, 10356);
  assert.ok(first?.description);
  assert.equal(first?.referents, null);
  service.get = get;
  const second = await loadGenius(ask, service, 200);
  assert.deepEqual(referentIds(second), [2001, 2002, 2003, 2004]);
  assert.equal(requests.filter((url) => url.includes("/referents?")).length, 1);
});

test("no match asks for no annotations, and insights turned off stop them", async () => {
  const { service, requests, storage } = phone();
  service.get = async (url) => {
    requests.push(url);
    return { meta: { status: 200 }, response: { hits: [] } };
  };
  assert.equal((await loadGenius(ask, service, 100))?.referents, null);
  assert.equal(requests.length, 1);
  const other = phone();
  const get = other.service.get;
  other.service.get = async (url, token) => {
    const reply = await get(url, token);
    if (url.includes("/songs/")) other.service.enabled = () => false;
    return reply;
  };
  assert.equal(await loadGenius(ask, other.service), null);
  assert.equal(other.storage.size, 0);
  assert.equal(storage.size, 1);
});
