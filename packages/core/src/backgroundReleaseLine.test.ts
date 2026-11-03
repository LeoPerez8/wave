import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogueOf, releaseBackgroundLine } from "./index.ts";

test("Settings shows the background lookup's songs done of total while it runs", () => {
  assert.deepEqual(releaseBackgroundLine({ done: 340, total: 2000, offline: false }), {
    done: 340,
    total: 2000,
  });
});

test("Settings shows no line when no background lookup runs", () => {
  assert.equal(releaseBackgroundLine(null), null);
  // A failed request leaves the run waiting for its retry: nothing is running then.
  assert.equal(releaseBackgroundLine({ done: 12, total: 2000, offline: true }), null);
});

test("the line and Search online's help come in English and Brazilian Portuguese", () => {
  assert.equal(
    catalogueOf("en").settings.findingReleaseDates(340, 2000),
    "Finding release dates: 340 of 2,000",
  );
  assert.equal(
    catalogueOf("pt-BR").settings.findingReleaseDates(340, 2000),
    "Buscando datas de lançamento: 340 de 2.000",
  );
  assert.match(catalogueOf("en").settings.alwaysSearchOnlineOpensAlbumsAndArtists, /release dates/);
  assert.match(
    catalogueOf("pt-BR").settings.alwaysSearchOnlineOpensAlbumsAndArtists,
    /datas de lançamento/,
  );
});
