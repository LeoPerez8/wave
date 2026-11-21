import assert from "node:assert/strict";
import { test } from "node:test";
import { createGeniusLyricsSearch } from "./geniusLyricsSearch.ts";

const HIT_URL = "https://genius.com/Massive-attack-teardrop-lyrics";
const reply = {
  meta: { status: 200 },
  response: {
    hits: [
      {
        type: "song",
        result: {
          id: 8,
          title: "Teardrop",
          primary_artist: { name: "Massive Attack" },
          artist_names: "Massive Attack",
          url: HIT_URL,
          song_art_image_thumbnail_url: "https://images.example/teardrop.jpg",
        },
      },
    ],
  },
};
const track = {
  id: 5,
  title: "Teardrop",
  artist: "Massive Attack",
  album: "Mezzanine",
  durationMs: 330_000,
};
const online = {
  videoId: "teardrop000",
  title: "Teardrop",
  artists: ["Massive Attack"],
  album: "Mezzanine",
  albumId: null,
  durationMs: 330_000,
  artworkUrl: null,
  explicit: false,
};

/** The search over a fake Worker, Library and YT Music; every effect is recorded. */
const setup = (
  change: {
    enabled?: boolean;
    account?: "signedIn" | "signedOut" | "unavailable";
    online?: boolean;
    ytMusic?: boolean;
    library?: readonly (typeof track)[];
    songs?: readonly (typeof online)[];
    answer?: (signal: AbortSignal) => Promise<{ status: number; body: string }>;
  } = {},
) => {
  const state = { enabled: true, account: "signedIn", online: true, ytMusic: true, ...change };
  const paths: string[] = [];
  const done: unknown[][] = [];
  const search = createGeniusLyricsSearch({
    enabled: () => state.enabled,
    account: () => state.account as "signedIn" | "signedOut" | "unavailable",
    online: () => state.online,
    request: async (_method, path, _body, signal) => {
      paths.push(path);
      return (await change.answer?.(signal)) ?? { status: 200, body: JSON.stringify(reply) };
    },
    library: () => change.library ?? [],
    ytMusic: () => state.ytMusic,
    searchSongs: async (query) => {
      done.push(["searchSongs", query]);
      return change.songs ?? [];
    },
    start: async (song) => void done.push(["start", song]),
    openUrl: async (url) => void done.push(["openUrl", url]),
  });
  return { search, state, paths, done };
};

test("a query of three or more words asks Genius through the Worker, a shorter one asks nothing", async () => {
  const { search, paths } = setup();
  assert.deepEqual(await search.search("massive attack"), { status: "idle" });
  assert.deepEqual(paths, []);
  const found = await search.search("love love is a verb");
  assert.deepEqual(paths, ["/v1/genius/search?q=love%20love%20is%20a%20verb"]);
  assert.deepEqual(found, {
    status: "hits",
    hits: [
      {
        id: 8,
        title: "Teardrop",
        artist: "Massive Attack",
        credit: "Massive Attack",
        url: HIT_URL,
        artworkUrl: "https://images.example/teardrop.jpg",
      },
    ],
  });
});

test("signed out, offline and a failed request each settle as their own state", async () => {
  const signedOut = setup({ account: "signedOut" });
  assert.deepEqual(await signedOut.search.search("one two three"), { status: "signedOut" });
  const offline = setup({ account: "signedOut", online: false });
  assert.deepEqual(await offline.search.search("one two three"), { status: "offline" });
  assert.deepEqual([...signedOut.paths, ...offline.paths], []);

  const refused = setup({ answer: async () => ({ status: 503, body: "" }) });
  assert.deepEqual(await refused.search.search("one two three"), { status: "failed" });
  const unreadable = setup({ answer: async () => ({ status: 200, body: '{"meta":{}}' }) });
  assert.deepEqual(await unreadable.search.search("one two three"), { status: "failed" });
  const dropped = setup({
    answer: async () => {
      dropped.state.online = false;
      throw new Error("connection lost");
    },
  });
  assert.deepEqual(await dropped.search.search("one two three"), { status: "offline" });
});

test("with Genius insights off, or no Wave account in the build, nothing is asked", async () => {
  const off = setup({ enabled: false });
  assert.deepEqual(await off.search.search("one two three"), { status: "disabled" });
  const none = setup({ account: "unavailable" });
  assert.deepEqual(await none.search.search("one two three"), { status: "disabled" });
  assert.deepEqual([...off.paths, ...none.paths], []);
});

test("Genius insights turned off while Genius is asked ends the request and shows nothing", async () => {
  let aborted = false;
  const { search, state } = setup({
    answer: (signal) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      }),
  });
  const answer = search.search("one two three");
  await new Promise((resolve) => setImmediate(resolve));
  state.enabled = false;
  search.cancel();
  assert.deepEqual(await answer, { status: "disabled" });
  assert.equal(aborted, true);
});

test("a clicked hit plays the Library's song when it has one, and asks YT Music nothing", async () => {
  const { search, done } = setup({ library: [track], songs: [online] });
  await search.search("one two three");
  assert.equal(await search.open(8), "played");
  assert.deepEqual(done, [["start", track]]);
});

test("a hit the Library lacks plays from YT Music after one Songs search", async () => {
  const { search, done } = setup({ songs: [online] });
  await search.search("one two three");
  const [first, second] = await Promise.all([search.open(8), search.open(8)]);
  assert.deepEqual([first, second], ["played", "played"]);
  assert.deepEqual(done, [
    ["searchSongs", "Teardrop Massive Attack"],
    ["start", online],
  ]);
});

test("with YT Music off, or no match there, a click opens the hit's Genius page", async () => {
  const off = setup({ ytMusic: false, songs: [online] });
  await off.search.search("one two three");
  assert.equal(await off.search.open(8), "opened");
  assert.deepEqual(off.done, [["openUrl", HIT_URL]]);

  const missing = setup({ songs: [{ ...online, title: "Another song" }] });
  await missing.search.search("one two three");
  assert.equal(await missing.search.open(8), "opened");
  assert.deepEqual(missing.done, [
    ["searchSongs", "Teardrop Massive Attack"],
    ["openUrl", HIT_URL],
  ]);
});

test("only a hit of the last answer opens, and only on Genius's site", async () => {
  const { search, done } = setup({ ytMusic: false });
  assert.equal(await search.open(8), "failed");
  await search.search("one two three");
  assert.equal(await search.open(9), "failed");

  const elsewhere = structuredClone(reply);
  elsewhere.response.hits[0]!.result.url = "https://genius.com.example.org/teardrop";
  const other = setup({
    ytMusic: false,
    answer: async () => ({ status: 200, body: JSON.stringify(elsewhere) }),
  });
  await other.search.search("one two three");
  assert.equal(await other.search.open(8), "failed");
  assert.deepEqual([...done, ...other.done], []);
});
