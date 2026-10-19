import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { NO_NETWORK_USE, answerBytes, networkUseLine, withNetworkUse } from "./index.ts";

describe("networkUseLine", () => {
  test("says how long the run took and, per host, its requests and bytes", () => {
    assert.equal(
      networkUseLine({
        what: "Artist mixes build",
        outcome: "4 mixes",
        durationMs: 34_217,
        use: {
          ytMusic: { requests: 18, bytes: 627_098 },
          deezer: { requests: 41, bytes: 276_582 },
        },
      }),
      "Artist mixes build (4 mixes) took 34.2 s: YouTube Music 18 requests, 612.4 KB; Deezer 41 requests, 270.1 KB",
    );
  });

  test("a host asked nothing says none; one request, small and large sizes read plainly", () => {
    assert.equal(
      networkUseLine({
        what: "Magic Queue radio",
        durationMs: 420,
        use: { ...NO_NETWORK_USE, ytMusic: { requests: 1, bytes: 812 } },
      }),
      "Magic Queue radio took 0.4 s: YouTube Music 1 request, 812 B; Deezer none",
    );
    assert.equal(
      networkUseLine({
        what: "Genre mixes build",
        outcome: "failed",
        durationMs: 61_050,
        use: { ...NO_NETWORK_USE, ytMusic: { requests: 52, bytes: 4_477_419 } },
      }),
      "Genre mixes build (failed) took 61.1 s: YouTube Music 52 requests, 4.27 MB; Deezer none",
    );
  });
});

describe("withNetworkUse", () => {
  test("adds a host's requests and bytes to what the run asked so far", () => {
    const once = withNetworkUse(NO_NETWORK_USE, "deezer", { requests: 1, bytes: 6_600 });
    const twice = withNetworkUse(once, "deezer", { requests: 1, bytes: 400 });
    assert.deepEqual(twice, {
      ytMusic: { requests: 0, bytes: 0 },
      deezer: { requests: 2, bytes: 7_000 },
    });
  });
});

describe("answerBytes", () => {
  test("is the answer's Content-Length when it gives one", () => {
    assert.equal(answerBytes("6612", '{"data":[]}'), 6_612);
  });

  test("is the answer's UTF-8 size without one, or with one that isn't a size", () => {
    assert.equal(answerBytes(null, '{"name":"Beyoncé"}'), 19);
    assert.equal(answerBytes("chunked", "日本"), 6);
  });
});
