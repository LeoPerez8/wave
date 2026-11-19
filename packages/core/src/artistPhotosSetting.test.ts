import assert from "node:assert/strict";
import { test } from "node:test";

import {
  catalogueOf,
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

test("the desktop says the photos are kept on the computer", () => {
  assert.match(catalogueOf("en", "desktop").settings.waveLooksUpAPhotoOfEach, /this computer/);
  assert.match(
    catalogueOf("pt-BR", "desktop").settings.waveLooksUpAPhotoOfEach,
    /neste computador/,
  );
  assert.match(catalogueOf("en").settings.waveLooksUpAPhotoOfEach, /your phone/);
});

test("the phone and the computer keep the switch under one synced key", () => {
  assert.equal(DOWNLOAD_ARTIST_PHOTOS_SETTING, "settings.downloadArtistPhotos");
});
