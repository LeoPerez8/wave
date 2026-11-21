import assert from "node:assert/strict";
import test from "node:test";
import { keepYtArtist, ytArtistSectionStart } from "./knownYtArtists.ts";

const found = {
  outcome: "found" as const,
  checkedAt: 1000,
  browseId: "UC_seen",
  page: { name: "Seen", songs: [], albums: [], singles: [] },
};

test("an artist page not seen this session starts reading what was saved", () => {
  assert.deepEqual(ytArtistSectionStart("yt:UC_unseen"), { status: "reading" });
});

test("an artist page seen this session starts with its answer, so its first frame draws it", () => {
  keepYtArtist("yt:UC_seen", found);
  assert.deepEqual(ytArtistSectionStart("yt:UC_seen"), {
    status: "ready",
    saved: found,
    failure: null,
  });
});

test("an older answer never replaces a newer one kept for the artist", () => {
  keepYtArtist("yt:UC_order", { outcome: "unmatched", checkedAt: 2000 });
  keepYtArtist("yt:UC_order", { ...found, checkedAt: 1500 });
  assert.deepEqual(ytArtistSectionStart("yt:UC_order"), {
    status: "ready",
    saved: { outcome: "unmatched", checkedAt: 2000 },
    failure: null,
  });
});
