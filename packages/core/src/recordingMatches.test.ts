import assert from "node:assert/strict";
import { test } from "node:test";
import { recordingMatches } from "./index.ts";

test("one recording matches normalized titles and shared artists, preserving versions and length", () => {
  const song = { title: "Déjà Vu", artists: ["Beyoncé"], durationMs: 180000 };
  const library = {
    title: "Deja Vu (Remastered 2011)",
    artist: "Beyoncé feat. Jay-Z",
    durationMs: 181000,
  };
  assert.equal(recordingMatches(library, song), true);
  assert.equal(recordingMatches({ ...library, title: "Deja Vu (Live)" }, song), false);
  assert.equal(recordingMatches({ ...library, artist: "Another Artist" }, song), false);
  assert.equal(recordingMatches({ ...library, durationMs: 184000 }, song), false);
  assert.equal(
    recordingMatches({ ...library, durationMs: 0 }, { ...song, durationMs: null }),
    true,
  );
  assert.equal(recordingMatches({ ...library, title: "" }, { ...song, title: "" }), false);
});
