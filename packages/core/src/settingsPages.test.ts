import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LAYOUT_PAGES,
  SETTINGS_PAGES,
  accountsSummary,
  downloadsSummary,
  visibleSettingsPages,
  queuedDownloadCounts,
  type SpotifySession,
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
  test("a fresh install hides Developer and revealing it adds only its row at the end", () => {
    assert.deepEqual(
      visibleSettingsPages().map(({ page }) => page),
      [
        "library",
        "appearance",
        "layout",
        "swipeActions",
        "playback",
        "history",
        "followedArtists",
        "lyricsAndTags",
        "downloads",
        "accounts",
      ],
    );
    assert.deepEqual(visibleSettingsPages(true), SETTINGS_PAGES);
    assert.deepEqual(visibleSettingsPages(false), visibleSettingsPages());
  });

  test("Settings lists its pages in order with their routes and glyphs, without page colours", () => {
    assert.deepEqual(SETTINGS_PAGES, [
      { page: "library", title: "Library", route: "/settings/library", icon: "books" },
      { page: "appearance", title: "Appearance", route: "/settings/appearance", icon: "palette" },
      { page: "layout", title: "Layout", route: "/settings/layout", icon: "layout" },
      {
        page: "swipeActions",
        title: "Swipe actions",
        route: "/settings/swipe-actions",
        icon: "swipe",
      },
      { page: "playback", title: "Playback", route: "/settings/playback", icon: "play" },
      { page: "history", title: "Listening History", route: "/settings/history", icon: "history" },
      {
        page: "followedArtists",
        title: "Followed Artists",
        route: "/settings/followed-artists",
        icon: "userCheck",
      },
      {
        page: "lyricsAndTags",
        title: "Lyrics and tags",
        route: "/settings/lyrics-and-tags",
        icon: "quote",
      },
      { page: "downloads", title: "Downloads", route: "/settings/downloads", icon: "download" },
      { page: "accounts", title: "Accounts", route: "/settings/accounts", icon: "user" },
      { page: "developer", title: "Developer", route: "/settings/developer", icon: "code" },
    ]);
  });
});

describe("the Layout page", () => {
  test("lists Home, Library, Playlists, Tab bar and Now Playing, each opening its own page", () => {
    assert.deepEqual(
      LAYOUT_PAGES.map(({ title, route }) => [title, route]),
      [
        ["Home", "/settings/layout/home"],
        ["Library", "/settings/layout/library"],
        ["Playlists", "/settings/layout/playlists"],
        ["Tab bar", "/settings/layout/tab-bar"],
        ["Now Playing", "/settings/layout/now-playing"],
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

  test("names the Spotify account between YT Music's and Wave's", () => {
    const spotify: SpotifySession = {
      status: "signedIn",
      account: { name: "leo.perez", photoUrl: null },
    };
    assert.equal(accountsSummary(YT_SIGNED_OUT, WAVE_SIGNED_OUT, spotify), "Spotify: leo.perez");
    assert.equal(
      accountsSummary(YT_SIGNED_IN, WAVE_SIGNED_IN, spotify),
      "YT Music: Leo Perez · Spotify: leo.perez · Wave: Leo",
    );
    assert.equal(
      accountsSummary(YT_SIGNED_OUT, WAVE_SIGNED_OUT, { status: "expired", account: null }),
      null,
    );
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

  test("says how many songs are on their way while any are, ahead of the failures", () => {
    const job = (videoId: string, phase: "queued" | "transferring") => ({
      id: videoId,
      song: {
        videoId,
        title: videoId,
        artists: [],
        album: null,
        durationMs: null,
        artworkUrl: null,
        explicit: false,
      },
      phase,
    });
    const queued = queuedDownloadCounts([
      job("a", "transferring"),
      job("b", "transferring"),
      ...["c", "d", "e", "f", "g"].map((id) => job(id, "queued")),
    ]);
    assert.equal(downloadsSummary(0, queued), "2 downloading · 5 waiting");
    assert.equal(downloadsSummary(3, queued), "2 downloading · 5 waiting · 3 songs failed");
    assert.equal(downloadsSummary(1, { downloading: 0, saving: 0, waiting: 0 }), "1 song failed");
  });
});
