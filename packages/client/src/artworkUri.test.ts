import assert from "node:assert/strict";
import { test } from "node:test";

import { artworkUri } from "./artworkUri.ts";

const cover = {
  thumbPath: "/covers/thumb.jpg",
  mediumPath: "/covers/medium.jpg",
  artworkPath: "/covers/original.png",
};

test("rows, tiles and full-size artwork choose the requested size", () => {
  assert.equal(artworkUri(cover, 150), "file:///covers/thumb.jpg");
  assert.equal(artworkUri(cover, 600), "file:///covers/medium.jpg");
  assert.equal(artworkUri(cover, 1000), "file:///covers/original.png");
});

test("photos win, then the requested size, then larger sizes, then the placeholder", () => {
  assert.equal(
    artworkUri({ ...cover, photo: { path: "/photos/artist.jpg" } }),
    "file:///photos/artist.jpg",
  );
  assert.equal(
    artworkUri({ ...cover, photo: { thumbPath: "/photos/small.jpg", path: "/photos/large.jpg" } }),
    "file:///photos/small.jpg",
  );
  assert.equal(
    artworkUri({ ...cover, photo: { path: "/photos/large.jpg" } }, "medium"),
    "file:///photos/large.jpg",
  );
  assert.equal(
    artworkUri({ mediumPath: cover.mediumPath, artworkPath: cover.artworkPath }),
    "file:///covers/medium.jpg",
  );
  assert.equal(artworkUri({ artworkPath: cover.artworkPath }), "file:///covers/original.png");
  assert.equal(artworkUri({ thumbPath: cover.thumbPath }, "medium"), undefined);
  assert.equal(artworkUri({ mediumPath: cover.mediumPath }, "original"), undefined);
  assert.equal(artworkUri(null), undefined);
  assert.equal(artworkUri({}), undefined);
});

test("existing URIs are preserved and remote fallback remains caller-controlled", () => {
  assert.equal(
    artworkUri({ artworkPath: "file:///covers/a.jpg" }, "original"),
    "file:///covers/a.jpg",
  );
  assert.equal(
    artworkUri({ imageUrl: "https://covers.example/a.jpg" }),
    "https://covers.example/a.jpg",
  );
  assert.equal(artworkUri({ artworkPath: "content://photos/1" }, "original"), "content://photos/1");
});

test("cached embedded covers ask the provider for a medium with an original fallback", () => {
  const hash = "0123456789abcdef0123456789abcdef01234567";
  const path = `/data/user/0/dev.leoperez.wave/files/artwork/${hash}.png`;
  assert.equal(
    artworkUri({ artworkPath: path }, "medium"),
    `content://dev.leoperez.wave.artwork/medium/${hash}`,
  );
  assert.equal(artworkUri({ artworkPath: path }, "original"), `file://${path}`);
  assert.equal(
    artworkUri({ artworkPath: path }, "thumbnail"),
    `content://dev.leoperez.wave.artwork/thumbnail/${hash}`,
  );
  assert.equal(
    artworkUri({ artworkPath: `/files/artwork/playlists/${hash}.jpg` }, "medium"),
    `file:///files/artwork/playlists/${hash}.jpg`,
  );
});

test("sized catalog images can recover originals for sharing and thumbnails for rows", () => {
  const hash = "0123456789abcdef0123456789abcdef01234567";
  const original = `/files/artwork/${hash}.jpg`;
  assert.equal(
    artworkUri(original, "thumbnail"),
    `content://dev.leoperez.wave.artwork/thumbnail/${hash}`,
  );
  assert.equal(
    artworkUri(`/files/artwork/${hash}_thumb.jpg`, "medium"),
    `content://dev.leoperez.wave.artwork/medium/${hash}`,
  );
  assert.equal(
    artworkUri(`content://dev.leoperez.wave.artwork/medium/${hash}`, "original"),
    `content://dev.leoperez.wave.artwork/${hash}`,
  );
});

test("remote artwork URLs that resemble cache filenames stay remote", () => {
  const remote = "https://covers.example/artwork/0123456789abcdef0123456789abcdef01234567.jpg";
  assert.equal(artworkUri(remote, "medium"), remote);
});

test("an already sized local image keeps its file URI at that size", () => {
  const hash = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(
    artworkUri(`/files/artwork/${hash}_thumb.jpg`, "thumbnail"),
    `file:///files/artwork/${hash}_thumb.jpg`,
  );
  assert.equal(
    artworkUri(`/files/artwork/${hash}_medium.jpg`, "medium"),
    `file:///files/artwork/${hash}_medium.jpg`,
  );
});

test("a playlist's own image shows its thumbnail through 300 px and its large file above", () => {
  const dir = "/data/user/0/dev.leoperez.wave/files/artwork/playlists";
  const hash = "0123456789abcdef0123456789abcdef01234567";
  const thumb = `${dir}/${hash}_thumb.jpg`;
  const large = `${dir}/${hash}.jpg`;
  assert.equal(artworkUri(thumb, 300), `file://${thumb}`);
  assert.equal(artworkUri(thumb, 301), `file://${large}`);
  assert.equal(artworkUri(thumb, 1080), `file://${large}`);
  assert.equal(artworkUri(large, 300), `file://${thumb}`);
  assert.equal(artworkUri(large, 1080), `file://${large}`);
});

test("a playlist image keeps its size through the mosaic's two passes", () => {
  const dir = "/files/artwork/playlists";
  const hash = "0123456789abcdef0123456789abcdef01234567";
  const mosaicCover = artworkUri(`${dir}/${hash}_thumb.jpg`, "original");
  assert.equal(artworkUri(mosaicCover, 120), `file://${dir}/${hash}_thumb.jpg`);
  assert.equal(artworkUri(mosaicCover, 900), `file://${dir}/${hash}.jpg`);
});

test("a photo framed from Wave's storage opens as itself at its original size", () => {
  const photo = "/files/artwork/playlists/0123456789abcdef0123456789abcdef01234567.jpg";
  assert.equal(artworkUri({ artworkPath: photo }, "original"), `file://${photo}`);
});
