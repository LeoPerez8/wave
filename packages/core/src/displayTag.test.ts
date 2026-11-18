import assert from "node:assert/strict";
import { test } from "node:test";
import { displayTag, UNKNOWN_ALBUM, UNKNOWN_ARTIST } from "./index.ts";

test("stored missing-tag names are translated for display without changing tagged names", () => {
  assert.equal(displayTag(UNKNOWN_ALBUM, "album", "pt-BR"), "Álbum Desconhecido");
  assert.equal(displayTag(UNKNOWN_ARTIST, "artist", "pt-BR"), "Artista Desconhecido");
  assert.equal(displayTag(UNKNOWN_ALBUM, "album", "en"), "Unknown Album");
  assert.equal(displayTag("OK Computer", "album", "pt-BR"), "OK Computer");
  assert.equal(displayTag("Unknown Album Live", "album", "pt-BR"), "Unknown Album Live");
  assert.equal(displayTag("", "album", "pt-BR"), "");
});
