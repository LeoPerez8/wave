import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LAYOUT_PAGES,
  SETTINGS_PAGES,
  accountsSummary,
  downloadsSummary,
  type WaveSession,
  type YtSession,
} from "./index.ts";

const YT_SIGNED_IN: YtSession = {
  status: "signedIn",
  account: { name: "Leo Perez", email: "leo@gmail.com", photoUrl: null },
};
const WAVE_SIGNED_IN: WaveSession = {
  status: "signedIn",
  account: { email: "leo@gmail.com", name: "Leo", photoUrl: null },
};
const YT_SIGNED_OUT: YtSession = { status: "signedOut" };
const WAVE_SIGNED_OUT: WaveSession = { status: "signedOut" };

describe("Settings pages", () => {
  test("Settings lists its pages in this order, each opening its own route", () => {
    assert.deepEqual(
      SETTINGS_PAGES.map(({ title, route }) => [title, route]),
      [
        ["Library", "/settings/library"],
        ["Appearance", "/settings/appearance"],
        ["Layout", "/settings/layout"],
        ["Playback", "/settings/playback"],
        ["Lyrics and tags", "/settings/lyrics-and-tags"],
        ["Downloads", "/settings/downloads"],
        ["Accounts", "/settings/accounts"],
        ["Developer", "/settings/developer"],
      ],
    );
  });
});

describe("the Layout page", () => {
  test("lists Home, Library, Playlists and Tab bar, each opening its own page", () => {
    assert.deepEqual(
      LAYOUT_PAGES.map(({ title, route }) => [title, route]),
      [
        ["Home", "/settings/layout/home"],
        ["Library", "/settings/layout/library"],
        ["Playlists", "/settings/layout/playlists"],
        ["Tab bar", "/settings/layout/tab-bar"],
      ],
    );
  });
});

describe("Accounts row summary", () => {
  test("names the YT Music account it's signed into", () => {
    assert.equal(accountsSummary(YT_SIGNED_IN, WAVE_SIGNED_OUT), "YT Music: Leo Perez");
  });

  test("names the Wave account by its name, or its email when Google gave none", () => {
    assert.equal(accountsSummary(YT_SIGNED_OUT, WAVE_SIGNED_IN), "Wave: Leo");
    assert.equal(
      accountsSummary(YT_SIGNED_OUT, {
        status: "signedIn",
        account: { email: "leo@gmail.com", name: null, photoUrl: null },
      }),
      "Wave: leo@gmail.com",
    );
  });

  test("signed into both, it names YT Music's first", () => {
    assert.equal(accountsSummary(YT_SIGNED_IN, WAVE_SIGNED_IN), "YT Music: Leo Perez · Wave: Leo");
  });

  test("an expired or ended session isn't named, and with nothing signed in there's no summary", () => {
    assert.equal(accountsSummary(YT_SIGNED_OUT, WAVE_SIGNED_OUT), null);
    assert.equal(
      accountsSummary(
        { status: "expired", account: { name: "Leo Perez", email: null, photoUrl: null } },
        { status: "ended", account: null },
      ),
      null,
    );
  });
});

describe("the Downloads row's line", () => {
  test("counts the songs whose download failed, and says nothing while none has", () => {
    assert.equal(downloadsSummary(0), null);
    assert.equal(downloadsSummary(1), "1 song failed");
    assert.equal(downloadsSummary(1200), "1,200 songs failed");
  });
});
