import assert from "node:assert/strict";
import { test } from "node:test";
import { smartLinkEnding } from "./smartLinkEnding.ts";

const ALBUM = "https://open.spotify.com/album/7rZmgT2kEqkCMR6VHcloJM";

test("reads the smart link's page once, with its body, and gives the link it points to", async () => {
  const asked: { url: string; body: boolean }[] = [];
  const ending = await smartLinkEnding(
    "https://fanlink.tv/dreams-album",
    async (url, body) => {
      asked.push({ url, body });
      return { url, body: `<a href="${ALBUM}">Spotify</a>` };
    },
    new AbortController().signal,
  );
  assert.deepEqual(asked, [{ url: "https://fanlink.tv/dreams-album", body: true }]);
  assert.deepEqual(ending, { link: ALBUM });
});

test("a smart link that redirects straight to a service's page opens that page", async () => {
  const ending = await smartLinkEnding(
    "https://lnk.to/x",
    async () => ({ url: ALBUM, body: "<html></html>" }),
    new AbortController().signal,
  );
  assert.deepEqual(ending, { link: ALBUM });
});

test("a smart link that redirects straight to an artist's page opens that artist", async () => {
  const artist = "https://open.spotify.com/artist/3bxfoVnARXp1QOgyAoKsc3";
  const ending = await smartLinkEnding(
    "https://lnk.to/x",
    async () => ({ url: artist, body: `<a href="${ALBUM}">Spotify</a>` }),
    new AbortController().signal,
  );
  assert.deepEqual(ending, { link: artist });
});

test("links the app doesn't open are passed over, where it landed too", async () => {
  const artist = "https://open.spotify.com/artist/3bxfoVnARXp1QOgyAoKsc3";
  const ending = await smartLinkEnding(
    "https://lnk.to/x",
    async () => ({ url: artist, body: `<a href="${ALBUM}">Spotify</a>` }),
    new AbortController().signal,
    (link) => link.service !== "spotifyArtist",
  );
  assert.deepEqual(ending, { link: ALBUM });
});

test("a page pointing nowhere opens nothing, and a page out of reach says so", async () => {
  assert.deepEqual(
    await smartLinkEnding(
      "https://lnk.to/x",
      async (url) => ({ url, body: "<html></html>" }),
      new AbortController().signal,
    ),
    { failure: "cantOpen" },
  );
  assert.deepEqual(
    await smartLinkEnding(
      "https://lnk.to/x",
      async () => {
        throw new Error("network");
      },
      new AbortController().signal,
    ),
    { failure: "unreachable" },
  );
});
