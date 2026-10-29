import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDue,
  releaseDateLine,
  deezerArtistAlbumsUrl,
  deezerReleases,
  deezerReleasesNext,
  keepFollowReleases,
  resolveDeezerFollowArtist,
  matchFollowRelease,
} from "./index.ts";
import sample from "./fixtures/followReleases.deezer.json" with { type: "json" };
test("Deezer replies keep dated releases and exact most-followed namesakes", () => {
  assert.deepEqual(
    deezerReleases(sample, "abba")?.map((r) => [r.key, r.type, r.explicit]),
    [
      ["deezer:1", "single", true],
      ["deezer:2", "ep", false],
    ],
  );
  assert.equal(deezerReleases({ error: {} }, "abba"), null);
  assert.equal(
    resolveDeezerFollowArtist(
      {
        data: [
          { id: 1, name: "ABBA", nb_fan: 2 },
          { id: 2, name: "The Abba", nb_fan: 10 },
          { id: 3, name: "Abbas", nb_fan: 100 },
        ],
      },
      "ABBA",
    ),
    2,
  );
});
test("release matching requires title and record type", () => {
  const r = deezerReleases(sample, "abba")![0]!;
  const album = {
    kind: "album" as const,
    browseId: "MPRE1",
    title: "New Song",
    artist: "ABBA",
    artworkUrl: null,
    year: 2026,
    releaseType: "single" as const,
  };
  assert.equal(matchFollowRelease(r, [album])?.browseId, "MPRE1");
  assert.equal(matchFollowRelease(r, [{ ...album, releaseType: "album" }]), null);
});
test("checks are due after twelve hours on Home and twenty four in background", () => {
  assert.equal(checkDue(null, 0, "home"), true);
  assert.equal(checkDue(0, 12 * 3600000 - 1, "home"), false);
  assert.equal(checkDue(0, 12 * 3600000, "home"), true);
  assert.equal(checkDue(0, 23 * 3600000, "background"), false);
  assert.equal(checkDue(0, 24 * 3600000, "background"), true);
});
test("date lines use calendar days and short absolute dates", () => {
  const now = new Date(2026, 9, 29, 12).getTime();
  assert.equal(releaseDateLine("2026-10-27", now), "2 days ago");
  assert.equal(releaseDateLine("2026-10-14", now), "Oct 14");
});

test("release date lines and type names follow the Portuguese catalogue", async () => {
  const { catalogueOf } = await import("./index.ts");
  const strings = catalogueOf("pt-BR");
  assert.equal(
    releaseDateLine("2026-10-27", new Date(2026, 9, 29, 12).getTime(), strings),
    "Há 2 dias",
  );
  assert.equal(strings.newReleases.album, "Álbum");
});

test("Deezer's next page is followed only for the same artist's albums, over HTTPS", () => {
  assert.equal(deezerArtistAlbumsUrl(13), "https://api.deezer.com/artist/13/albums?limit=100");
  const next = (value: unknown) => deezerReleasesNext({ data: [], next: value }, 13);
  assert.equal(
    next("http://api.deezer.com/artist/13/albums?limit=100&index=100"),
    "https://api.deezer.com/artist/13/albums?limit=100&index=100",
  );
  assert.equal(
    next("https://api.deezer.com/artist/13/albums?index=200"),
    "https://api.deezer.com/artist/13/albums?index=200",
  );
  assert.equal(next("https://api.deezer.com/artist/14/albums?index=100"), null);
  assert.equal(next("https://api.deezer.com/artist/13/albumsx?index=100"), null);
  assert.equal(next("https://evil.example/artist/13/albums"), null);
  assert.equal(next("https://api.deezer.com.evil.example/artist/13/albums"), null);
  assert.equal(next(42), null);
  assert.equal(deezerReleasesNext({ data: [] }, 13), null);
  assert.equal(deezerReleasesNext("nope", 13), null);
});

test("a check keeps earlier YT Music matches and releases Deezer left out", () => {
  const release = (key: string, browseId: string | null = null) => ({
    key,
    artistKey: "abba",
    title: key,
    type: "album" as const,
    releaseDate: "2026-10-01",
    artworkUrl: null,
    explicit: false,
    browseId,
    videoIds: browseId === null ? [] : [`${key}-video`],
    recordingKeys: [],
  });
  const kept = keepFollowReleases(
    [release("deezer:1"), release("deezer:2")],
    [release("deezer:1", "MPREb_1"), release("deezer:3", "MPREb_3")],
  );
  assert.deepEqual(
    kept.map((r) => [r.key, r.browseId, r.videoIds]),
    [
      ["deezer:1", "MPREb_1", ["deezer:1-video"]],
      ["deezer:2", null, []],
      ["deezer:3", "MPREb_3", ["deezer:3-video"]],
    ],
  );
  assert.deepEqual(keepFollowReleases([release("deezer:1")], undefined).length, 1);
});
