import assert from "node:assert/strict";
import test from "node:test";
import { nowPlayingLibraryArtistLink } from "./artistLink.ts";

test("a known local track has a first-frame link and reads credits only on the tap", async () => {
  let reads = 0;
  const destinations: unknown[] = [];
  const line = nowPlayingLibraryArtistLink({
    trackId: 9,
    details: null,
    here: "/library/songs",
    read: async () => {
      reads++;
      return { artistIds: [3, 8] };
    },
    follow: (link) => destinations.push(link),
    reveal: () => destinations.push("here"),
    unavailable: () => assert.fail("artist exists"),
  });
  assert.equal(reads, 0);
  assert.equal(line.revealsCurrentScreen, false);
  await line.open();
  assert.equal(reads, 1);
  assert.deepEqual(destinations, [{ kind: "choose", artistIds: [3, 8] }]);
});

test("warm local credits open without a read and a same-page tap only reveals it", async () => {
  const events: unknown[] = [];
  const options = {
    trackId: 9,
    details: { artistIds: [3] },
    here: "/library/songs",
    read: async () => {
      assert.fail("warm credits");
    },
    follow: (link: unknown) => {
      events.push(link);
    },
    reveal: () => {
      events.push("here");
    },
    unavailable: () => assert.fail("warm artist"),
  };
  const line = nowPlayingLibraryArtistLink(options);
  const opened = line.open();
  assert.deepEqual(events, [{ kind: "open", artistId: 3 }]);
  await opened;
  const same = nowPlayingLibraryArtistLink({ ...options, here: "/library/artist/3" });
  assert.equal(same.revealsCurrentScreen, true);
  await same.open();
  assert.equal(events.at(-1), "here");
});

test("gone local songs and failed credit reads explain the tap", async () => {
  for (const read of [
    async () => null,
    async () => {
      throw new Error("closed");
    },
  ]) {
    let explanations = 0;
    await nowPlayingLibraryArtistLink({
      trackId: 9,
      details: null,
      here: "/library/songs",
      read,
      follow: () => assert.fail("gone"),
      reveal: () => assert.fail("gone"),
      unavailable: () => {
        explanations++;
      },
    }).open();
    assert.equal(explanations, 1);
  }
});
