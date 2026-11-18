import assert from "node:assert/strict";
import { test } from "node:test";

import { catalogueOf, ytAccountNotes, type YtAccountNote } from "./index.ts";

const NOTES: readonly YtAccountNote[] = ["optional", "expired", "offline", "failed"];

test("every note under YouTube's Sign In has its own text, in each language", () => {
  for (const language of ["en", "pt-BR"] as const)
    for (const surface of [undefined, "desktop"] as const) {
      const notes = ytAccountNotes(catalogueOf(language, surface));
      assert.equal(new Set(NOTES.map((note) => notes[note])).size, NOTES.length, language);
    }
});

test("the desktop's YouTube lines name the computer where the phone's name the phone", () => {
  const phone = catalogueOf("en");
  const desktop = catalogueOf("en", "desktop");
  assert.match(ytAccountNotes(phone).optional, /on this phone/);
  assert.match(ytAccountNotes(desktop).optional, /on this computer/);
  assert.doesNotMatch(ytAccountNotes(desktop).optional, /phone/);
  assert.match(desktop.settings.searchPlaybackAndHomesMixesUseThis, /on this computer/);
  for (const language of ["en", "pt-BR"] as const) {
    const text = catalogueOf(language, "desktop");
    assert.doesNotMatch(text.settings.ytMusicNote, /phone|telefone/);
    assert.doesNotMatch(text.settings.searchPlaybackAndHomesMixesUseThis, /phone|telefone/);
    // The sign-in happens in a browser window the owner closes, and needs one Wave can start.
    assert.ok(text.desktopAccount.closeBrowserWhenDone.length > 0);
    assert.match(text.desktopAccount.noBrowser, /Chrome, Edge, Brave/);
  }
});
