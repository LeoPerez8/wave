import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DISCOVER_LEVEL_SETTING,
  DISCOVER_SLIDERS_SETTING,
  DJ_REMEMBERED_SETTING,
  DONT_PLAY_EXPLICIT_SETTING,
  FOLLOWED_ARTISTS_SETTING,
  HOME_ARRANGEMENT_SETTING,
  PLAYLIST_LAYOUT_SETTING,
  PLAYLIST_ORDER_SETTING,
  SEARCH_ONLINE_SETTING,
  SHOW_CHECKS_TODAY_SETTING,
  STAR_ASKED_SETTING,
  SYNCED_STARS_SETTING,
} from "./index.ts";

// Stored on every device, and some synced with the account: a changed value loses the setting.
test("the phone and the computer keep each setting under the key it has always had", () => {
  assert.deepEqual(
    {
      DISCOVER_LEVEL_SETTING,
      DISCOVER_SLIDERS_SETTING,
      DJ_REMEMBERED_SETTING,
      DONT_PLAY_EXPLICIT_SETTING,
      FOLLOWED_ARTISTS_SETTING,
      HOME_ARRANGEMENT_SETTING,
      PLAYLIST_LAYOUT_SETTING,
      PLAYLIST_ORDER_SETTING,
      SEARCH_ONLINE_SETTING,
      SHOW_CHECKS_TODAY_SETTING,
      STAR_ASKED_SETTING,
      SYNCED_STARS_SETTING,
    },
    {
      DISCOVER_LEVEL_SETTING: "home.discoverLevel",
      DISCOVER_SLIDERS_SETTING: "home.discoverSliders",
      DJ_REMEMBERED_SETTING: "dj.remembered",
      DONT_PLAY_EXPLICIT_SETTING: "settings.dontPlayExplicit",
      FOLLOWED_ARTISTS_SETTING: "settings.followedArtists",
      HOME_ARRANGEMENT_SETTING: "settings.homeArrangement",
      PLAYLIST_LAYOUT_SETTING: "settings.playlistLayout",
      PLAYLIST_ORDER_SETTING: "settings.playlistOrder",
      SEARCH_ONLINE_SETTING: "settings.searchOnline",
      SHOW_CHECKS_TODAY_SETTING: "shows.checksToday",
      STAR_ASKED_SETTING: "downloads.starAsked",
      SYNCED_STARS_SETTING: "downloads.syncedStars",
    },
  );
});
