import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DOWNLOAD_ARTIST_PHOTOS_SETTING,
  readDownloadArtistPhotos,
  writeDownloadArtistPhotos,
} from "./index.ts";

test("downloading artist photos is on when nothing is stored", () => {
  assert.equal(readDownloadArtistPhotos(null), true);
  assert.equal(readDownloadArtistPhotos(undefined), true);
  assert.equal(readDownloadArtistPhotos("later"), true);
});

test("off is stored as off and on as the default", () => {
  assert.equal(writeDownloadArtistPhotos(false), "off");
  assert.equal(writeDownloadArtistPhotos(true), null);
  assert.equal(readDownloadArtistPhotos("off"), false);
});

test("the phone and the computer keep the switch under one synced key", () => {
  assert.equal(DOWNLOAD_ARTIST_PHOTOS_SETTING, "settings.downloadArtistPhotos");
});
