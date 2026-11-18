import assert from "node:assert/strict";
import { test } from "node:test";
import { ytTrackId, type QueueEntry } from "@wave/core";
import { createYtMusic, type YtCall } from "./ytMusic.ts";

const songOf = (videoId: string, title = `Song ${videoId}`) => ({
  videoId,
  title,
  artists: ["Nick Drake"],
  album: "Pink Moon",
  albumId: "MPREb_pinkmoon",
  durationMs: 124_000,
  artworkUrl: "https://lh3.googleusercontent.com/cover=w120-h120",
  explicit: false,
  videoType: "MUSIC_VIDEO_TYPE_ATV",
});

const coded = (code: string) => Object.assign(new Error("no"), { code });

/** YtMusic over an in-memory settings table and a JVM that answers with `answer`. */
const setup = (
  answer: (method: string, params: unknown) => unknown = () => null,
  saved: Record<string, string> = {},
) => {
  const settings = new Map(Object.entries(saved));
  const calls: string[] = [];
  const call: YtCall = async (method, params) => {
    calls.push(`${method} ${JSON.stringify(params)}`);
    return answer(method, params) as never;
  };
  const yt = createYtMusic({
    read: (key) => settings.get(key),
    save: (key, value) => void settings.set(key, value),
    call,
  });
  return { yt, settings, calls };
};

test("YT Music is on until it's turned off, and the JVM is told each time", async () => {
  const { yt, settings, calls } = setup();
  assert.equal(yt.enabled(), true);
  await yt.start();
  await yt.setEnabled(false);
  assert.equal(yt.enabled(), false);
  assert.equal(settings.get("settings.ytMusic"), "off", "the phone's encoding");
  await yt.setEnabled(true);
  assert.equal(yt.enabled(), true);
  assert.deepEqual(calls, [
    'setYtMusic {"enabled":true}',
    'setYtMusic {"enabled":false}',
    'setYtMusic {"enabled":true}',
  ]);
});

test("a search answers YouTube Music's songs and remembers them for playback", async () => {
  const { yt } = setup((method) =>
    method === "search"
      ? { songs: [songOf("abcdefghijk"), { videoId: "bad" }, songOf("bcdefghijkl")] }
      : null,
  );
  const found = await yt.search("pink moon");
  assert.equal(found.status, "ok");
  assert.deepEqual(
    found.songs.map((song) => song.videoId),
    ["abcdefghijk", "bcdefghijkl"],
    "malformed rows are skipped",
  );
  assert.equal(yt.song("abcdefghijk")?.title, "Song abcdefghijk");
});

test("a search tells offline, off and failed apart, and never rejects", async () => {
  const failing = (code: string) =>
    setup(() => {
      throw coded(code);
    }).yt;
  assert.equal((await failing("ERR_YT_OFFLINE").search("a")).status, "offline");
  assert.equal((await failing("ERR_YT_DISABLED").search("a")).status, "disabled");
  assert.equal((await failing("ERR_YT_FAILED").search("a")).status, "failed");
  const { yt, calls } = setup(() => ({ songs: [] }), { "settings.ytMusic": "off" });
  assert.deepEqual(await yt.search("a"), { status: "disabled", songs: [] });
  assert.deepEqual(calls, [], "YT Music off asks nothing");
});

test("an empty query asks nothing", async () => {
  const { yt, calls } = setup();
  assert.deepEqual(await yt.search("   "), { status: "ok", songs: [] });
  assert.deepEqual(calls, []);
});

test("a stream address keeps only what the engine needs", async () => {
  const { yt, calls } = setup(() => ({
    url: "https://rr1.example.invalid/videoplayback?x=1",
    headers: { "User-Agent": "ua" },
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    itag: 140,
    contentLength: 3_000_000,
    expiresAtMs: 1,
    loudnessDb: -7,
  }));
  assert.deepEqual(await yt.resolve("abcdefghijk", true), {
    url: "https://rr1.example.invalid/videoplayback?x=1",
    headers: { "User-Agent": "ua" },
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    itag: 140,
    contentLength: 3_000_000,
  });
  assert.deepEqual(calls, ['resolveStream {"videoId":"abcdefghijk","fresh":true}']);
});

test("an address isn't asked for while YT Music is off, nor taken when it isn't https", async () => {
  const off = setup(() => null, { "settings.ytMusic": "off" });
  await assert.rejects(off.yt.resolve("abcdefghijk", false), { code: "ERR_YT_DISABLED" });
  assert.deepEqual(off.calls, []);
  const plain = setup(() => ({ url: "http://a.invalid/", headers: {}, mimeType: "", itag: 1 }));
  await assert.rejects(plain.yt.resolve("abcdefghijk", false), { code: "ERR_YT_FAILED" });
});

test("the queue's YT Music songs are kept for the next launch, and known again from them", async () => {
  const { yt, settings } = setup((method) =>
    method === "search" ? { songs: [songOf("abcdefghijk"), songOf("bcdefghijkl")] } : null,
  );
  await yt.search("pink moon");
  const entries: QueueEntry[] = [
    { trackId: "7", key: "a", contextIndex: 0 },
    { trackId: ytTrackId("bcdefghijkl"), key: "b", contextIndex: 1 },
  ];
  yt.keepQueued(entries);
  const kept = JSON.parse(settings.get("playback.ytTracks") ?? "[]") as { videoId: string }[];
  assert.deepEqual(
    kept.map((song) => song.videoId),
    ["bcdefghijkl"],
  );

  const next = setup(() => null, Object.fromEntries(settings));
  assert.equal(next.yt.song("bcdefghijkl")?.title, "Song bcdefghijkl");
  assert.equal(next.yt.song("abcdefghijk"), undefined);
});

test("a broken saved queue is ignored", () => {
  const { yt } = setup(() => null, { "playback.ytTracks": "{not json" });
  assert.equal(yt.song("abcdefghijk"), undefined);
});

test("covers come only from YouTube's image hosts, as small images, and are kept", async () => {
  const fetched: string[] = [];
  const fetch = async (url: string | URL | Request) => {
    fetched.push(String(url));
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
  };
  const yt = createYtMusic({
    read: () => undefined,
    save: () => {},
    call: async () => null as never,
    fetch: fetch as typeof globalThis.fetch,
  });
  const cover = "https://lh3.googleusercontent.com/abc=w120-h120";
  assert.equal(await yt.artwork(cover), "data:image/jpeg;base64,AQID");
  assert.equal(await yt.artwork(cover), "data:image/jpeg;base64,AQID");
  assert.equal(
    (await yt.artwork("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg")) !== null,
    true,
  );
  assert.notEqual(
    await yt.artwork("https://yt3.googleusercontent.com/def=w120-h120"),
    null,
    "YouTube Music's song covers come from yt3 too",
  );
  assert.equal(await yt.artwork("http://lh3.googleusercontent.com/abc"), null, "https only");
  assert.equal(await yt.artwork("https://evil.example/abc.jpg"), null);
  assert.equal(await yt.artwork("https://googleusercontent.com.evil.example/a"), null);
  assert.equal(fetched.length, 3, "the cover is fetched once");
});

test("a cover that isn't a small image, or doesn't arrive, is no cover", async () => {
  const answering = (response: () => Response | Promise<Response>) =>
    createYtMusic({
      read: () => undefined,
      save: () => {},
      call: async () => null as never,
      fetch: (async () => response()) as typeof globalThis.fetch,
      maxArtworkBytes: 4,
    });
  const url = "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg";
  const html = answering(
    () => new Response("<html>", { headers: { "content-type": "text/html" } }),
  );
  assert.equal(await html.artwork(url), null);
  const big = answering(
    () => new Response(new Uint8Array(10), { headers: { "content-type": "image/png" } }),
  );
  assert.equal(await big.artwork(url), null);
  const offline = answering(() => Promise.reject(new TypeError("fetch failed")));
  assert.equal(await offline.artwork(url), null);
});

test("songs a page brought are known for playback like a search's", () => {
  const { yt } = setup();
  assert.equal(yt.song("abcdefghijk"), undefined);
  yt.keep([songOf("abcdefghijk", "Pink Moon")] as never);
  assert.equal(yt.song("abcdefghijk")?.title, "Pink Moon");
});
