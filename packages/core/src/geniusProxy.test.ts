import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  geniusReferentsPath,
  geniusSearchPath,
  geniusSongPath,
  geniusUpstreamUrl,
} from "./index.ts";

/** What the service asks Genius for the phone's [path]. */
const upstream = (path: string): string | null => {
  const url = new URL(path, "https://sync.wave.test");
  return geniusUpstreamUrl(url.pathname, url.searchParams);
};

describe("Genius through the sync service", () => {
  test("each phone request stands for the Genius request the phone used to send", () => {
    assert.equal(
      upstream(geniusSearchPath({ title: "Bohemian Rhapsody", artist: "Queen" })),
      "https://api.genius.com/search?q=Bohemian%20Rhapsody%20Queen",
    );
    assert.equal(
      upstream(geniusSearchPath({ title: "Águas de Março", artist: "Elis & Tom" })),
      "https://api.genius.com/search?q=%C3%81guas%20de%20Mar%C3%A7o%20Elis%20%26%20Tom",
    );
    assert.equal(
      upstream(geniusSearchPath({ title: "What?/#1 +", artist: "AC/DC" })),
      "https://api.genius.com/search?q=What%3F%2F%231%20%2B%20AC%2FDC",
    );
    assert.equal(
      upstream(geniusSongPath(1063)),
      "https://api.genius.com/songs/1063?text_format=plain",
    );
    assert.equal(
      upstream(geniusReferentsPath(1063, 20)),
      "https://api.genius.com/referents?song_id=1063&text_format=plain&per_page=50&page=20",
    );
  });

  test("anything else stands for no Genius request", () => {
    for (const path of [
      "/v1/genius/search?q=a&text_format=html",
      "/v1/genius/song?id=1063&id=1064",
      "/v1/genius/song?id=0x10",
      "/v1/genius/referents?song=1063&page=21",
      "/v1/genius/referents?page=1&song=1063&per_page=1",
      "/v1/genius/songs?id=1063",
      "/v1/pull",
    ]) {
      assert.equal(upstream(path), null, path);
    }
    assert.equal(upstream(geniusReferentsPath(1063, 21)), null);
  });
});
