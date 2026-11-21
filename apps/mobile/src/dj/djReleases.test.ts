import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DJ_SETTINGS,
  djArtistTile,
  startDjQueue,
  type DjSettings,
  type YtArtistSaved,
} from "@wave/core";

import { djReleasePagesReader } from "./djReleases.ts";

const session = (settings: Partial<DjSettings>, id = "dj1") =>
  startDjQueue([djArtistTile("Portishead")!, djArtistTile("Tricky")!, djArtistTile("Lamb")!], {
    id,
    settings: { ...DEFAULT_DJ_SETTINGS, ...settings },
  })!;

const found = (name: string, year: number): YtArtistSaved => ({
  outcome: "found",
  checkedAt: 0,
  browseId: `UC${name}`,
  page: {
    name,
    songs: [],
    albums: [
      {
        kind: "album",
        browseId: `MPREb_${name}`,
        title: "Record",
        artists: [name],
        year,
        artworkUrl: null,
      },
    ],
    singles: [],
  },
});

/** A phone where Portishead's page is saved, Tricky had no match and Lamb's read fails. */
const phone = () => {
  const read: string[] = [];
  return {
    read,
    saved: (name: string): Promise<YtArtistSaved | null> => {
      read.push(name);
      if (name === "Portishead") return Promise.resolve(found(name, 2026));
      if (name === "Tricky") return Promise.resolve({ outcome: "unmatched", checkedAt: 0 });
      return Promise.reject(new Error("unreadable"));
    },
  };
};

test("New releases reads the saved pages of the session's artists, whichever are there", async () => {
  const dj = phone();
  const pages = await djReleasePagesReader(dj.saved)(session({ newReleases: true }), null);
  assert.deepEqual(dj.read, ["Portishead", "Tricky", "Lamb"]);
  assert.deepEqual(
    pages.map((page) => [page.name, page.albums.map((album) => album.year), page.singles]),
    [["Portishead", [2026], []]],
  );
});

test("with New releases off no page is read", async () => {
  const dj = phone();
  assert.deepEqual(await djReleasePagesReader(dj.saved)(session({}), null), []);
  assert.deepEqual(dj.read, []);
});

test("a session's pages are read once, and another session's again", async () => {
  const dj = phone();
  const pagesOf = djReleasePagesReader(dj.saved);
  const first = await pagesOf(session({ newReleases: true }), null);
  assert.equal(await pagesOf(session({ newReleases: true }), null), first);
  assert.equal(dj.read.length, 3);
  await pagesOf(session({ newReleases: true }, "dj2"), null);
  assert.equal(dj.read.length, 6);
});
