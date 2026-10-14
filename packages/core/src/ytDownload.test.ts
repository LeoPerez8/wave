import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ytDownloadDestination,
  ytDownloadLookup,
  ytDownloadRoot,
  ytDownloadTags,
  ytDownloadTarget,
} from "./index.ts";
import type { YtAlbum, YtSong } from "./index.ts";

const ROOT = "/storage/emulated/0/Music";

/** Names are kept under 255 bytes (ext4, f2fs, exFAT) with room for a temp or " (2)" suffix. */
const MAX_NAME_BYTES = 240;
const utf8Length = (text: string): number => Buffer.byteLength(text, "utf8");

const getLucky: YtSong = {
  videoId: "4D7u5KF7SP8",
  title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
  artists: ["Daft Punk", "Pharrell Williams", "Nile Rodgers"],
  album: "Random Access Memories",
  durationMs: 370_000,
  artworkUrl: "https://lh3.googleusercontent.com/song=w120-h120-l90-rj",
  explicit: false,
};

const COVER = "https://yt3.googleusercontent.com/N55arCGj=w544-h544-l90-rj";

const ram: YtAlbum = {
  title: "Random Access Memories",
  artists: ["Daft Punk"],
  year: 2013,
  artworkUrl: COVER,
  tracks: [
    { videoId: "IluRBvnYMoY", title: "Give Life Back to Music", trackNumber: 1 },
    {
      videoId: "5NV6Rdv1a3I",
      title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
      trackNumber: 8,
      discNumber: null,
    },
    { videoId: "ZbbTmR6Xaag", title: "Contact", trackNumber: 13 },
  ],
};

describe("ytDownloadTags", () => {
  test("keeps an available disc number for MP3 tags", () => {
    const album = { ...ram, tracks: [{ ...ram.tracks[1]!, discNumber: 2 }] };
    assert.equal(ytDownloadTags(getLucky, album, null, null).discNumber, 2);
  });
  test("tags a song with its album's title, artist, year and its track number", () => {
    const tags = ytDownloadTags(
      getLucky,
      ram,
      {
        lyrics: { synced: true, text: "[00:01.00]Like the legend" },
        genre: "Dance",
        trackNumber: null,
        discNumber: null,
        year: null,
      },
      null,
    );
    assert.deepEqual(tags, {
      title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
      artist: "Daft Punk, Pharrell Williams & Nile Rodgers",
      album: "Random Access Memories",
      albumArtist: "Daft Punk",
      year: 2013,
      // YT Music lists the album's own video of the song: the title tells it.
      trackNumber: 8,
      discNumber: null,
      genre: "Dance",
      lyrics: "[00:01.00]Like the legend",
      artworkUrl: "https://yt3.googleusercontent.com/N55arCGj=w1200-h1200-l90-rj",
    });
  });

  test("finds the song in its album by video id first", () => {
    const album = {
      ...ram,
      tracks: [
        { videoId: "aaaaaaaaaaa", title: "Get Lucky", trackNumber: 2 },
        { videoId: "4D7u5KF7SP8", title: "Get Lucky (Radio Edit)", trackNumber: 5 },
      ],
    };
    assert.equal(ytDownloadTags(getLucky, album, null, null).trackNumber, 5);
  });

  test("a song its album doesn't list has no track number", () => {
    const album = { ...ram, tracks: ram.tracks.filter((track) => track.trackNumber !== 8) };
    assert.equal(ytDownloadTags(getLucky, album, null, null).trackNumber, null);
  });

  test("without its album page, the song's own album and artists stand in", () => {
    const tags = ytDownloadTags(getLucky, null, null, null);
    assert.equal(tags.album, "Random Access Memories");
    assert.equal(tags.albumArtist, "Daft Punk, Pharrell Williams & Nile Rodgers");
    assert.equal(tags.year, null);
    assert.equal(tags.trackNumber, null);
    assert.equal(tags.artworkUrl, "https://lh3.googleusercontent.com/song=w1200-h1200-l90-rj");
  });

  test("Deezer's track number, disc and year stand in for what the album page doesn't give", () => {
    const found = {
      lyrics: null,
      genre: "Dance",
      trackNumber: 8,
      discNumber: 2,
      year: 2013,
    };
    const withoutPage = ytDownloadTags(getLucky, null, found, null);
    assert.deepEqual(
      [withoutPage.trackNumber, withoutPage.discNumber, withoutPage.year],
      [8, 2, 2013],
    );
    const unlisted = { ...ram, year: null, tracks: [] };
    const fromDeezer = ytDownloadTags(getLucky, unlisted, found, null);
    assert.deepEqual(
      [fromDeezer.trackNumber, fromDeezer.discNumber, fromDeezer.year],
      [8, 2, 2013],
    );
  });

  test("the album page's track number, disc and year win over Deezer's", () => {
    const found = { lyrics: null, genre: null, trackNumber: 3, discNumber: 2, year: 2023 };
    const tags = ytDownloadTags(getLucky, ram, found, null);
    // The page numbers the song without a disc: Deezer's disc doesn't go with its number.
    assert.deepEqual([tags.trackNumber, tags.discNumber, tags.year], [8, null, 2013]);
  });

  test("an album page that credits nobody leaves the album artist to the song's artists", () => {
    const tags = ytDownloadTags(getLucky, { ...ram, artists: [] }, null, null);
    assert.equal(tags.albumArtist, "Daft Punk, Pharrell Williams & Nile Rodgers");
  });

  test("YouTube Music's own lyrics are only the fallback", () => {
    const place = { trackNumber: null, discNumber: null, year: null };
    const found = { lyrics: { synced: false, text: "Plain from LRCLIB" }, genre: null, ...place };
    assert.equal(ytDownloadTags(getLucky, ram, found, "From YouTube").lyrics, "Plain from LRCLIB");
    const none = { lyrics: null, genre: "Disco", ...place };
    assert.equal(
      ytDownloadTags(getLucky, ram, none, "Line one\r\nLine two\r\n").lyrics,
      "Line one\nLine two",
    );
    assert.equal(ytDownloadTags(getLucky, ram, null, "From YouTube").lyrics, "From YouTube");
    assert.equal(ytDownloadTags(getLucky, ram, none, " \r\n ").lyrics, null);
  });

  test("a cover that isn't on YouTube Music's image server is kept as it is", () => {
    const song = { ...getLucky, artworkUrl: "https://i.ytimg.com/vi/x/hqdefault.jpg" };
    assert.equal(
      ytDownloadTags(song, null, null, null).artworkUrl,
      "https://i.ytimg.com/vi/x/hqdefault.jpg",
    );
    assert.equal(
      ytDownloadTags({ ...getLucky, artworkUrl: null }, null, null, null).artworkUrl,
      null,
    );
  });
});

test("download destination chooses an included final folder and saves Soulseek's MP3", () => {
  const tags = ytDownloadTags(getLucky, null, null, null);
  const roots = [
    { path: ROOT, isDefault: true },
    { path: "/sdcard/Other", isDefault: false },
  ];
  assert.equal(
    ytDownloadDestination(
      roots,
      [`${ROOT}/Daft Punk, Pharrell Williams & Nile Rodgers/Random Access Memories`],
      tags,
      "soulseek",
    )?.path,
    "/sdcard/Other/Daft Punk, Pharrell Williams & Nile Rodgers/Random Access Memories/Get Lucky (feat. Pharrell Williams and Nile Rodgers).mp3",
  );
  assert.equal(ytDownloadDestination(roots, [ROOT, "/sdcard/Other"], tags, "soulseek"), null);
});

test("a download from YouTube Music lands in the same place as an M4A, under the same exclusions", () => {
  const tags = { ...ytDownloadTags(getLucky, null, null, null), trackNumber: 8 };
  const roots = [
    { path: ROOT, isDefault: true },
    { path: "/sdcard/Other", isDefault: false },
  ];
  assert.equal(
    ytDownloadDestination(roots, [], tags, "youtube")?.path,
    `${ROOT}/Daft Punk, Pharrell Williams & Nile Rodgers/Random Access Memories/08 Get Lucky (feat. Pharrell Williams and Nile Rodgers).m4a`,
  );
  assert.equal(
    ytDownloadDestination(roots, [ROOT], tags, "youtube")?.path,
    "/sdcard/Other/Daft Punk, Pharrell Williams & Nile Rodgers/Random Access Memories/08 Get Lucky (feat. Pharrell Williams and Nile Rodgers).m4a",
  );
  assert.equal(ytDownloadDestination(roots, [ROOT, "/sdcard/Other"], tags, "youtube"), null);
});

describe("ytDownloadLookup", () => {
  test("looks a download up by its title, its first artist, album and length", () => {
    assert.deepEqual(ytDownloadLookup(getLucky, ram), {
      title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
      artist: "Daft Punk",
      album: "Random Access Memories",
      durationMs: 370_000,
    });
  });

  test("without an album page or a length, sends what the song has", () => {
    assert.deepEqual(ytDownloadLookup({ ...getLucky, album: null, durationMs: null }, null), {
      title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
      artist: "Daft Punk",
      album: null,
      durationMs: 0,
    });
  });

  test("a song credited to Various Artists isn't looked up", () => {
    assert.equal(ytDownloadLookup({ ...getLucky, artists: ["Various Artists"] }, null), null);
  });
});

const root = (path: string, isDefault = false) => ({ path, isDefault });

describe("ytDownloadRoot", () => {
  test("downloads go into the default scan root", () => {
    assert.equal(ytDownloadRoot([root("/sd/Albums"), root(ROOT, true)]), ROOT);
  });

  test("once the owner picked their own folders, into the first of them", () => {
    assert.equal(ytDownloadRoot([root("/sd/Albums"), root("/sd/Singles")]), "/sd/Albums");
  });

  test("without any music folder there's nowhere to download to", () => {
    assert.equal(ytDownloadRoot([]), null);
  });
});

describe("ytDownloadTarget", () => {
  test("files a song in the Library's tree: its album artist, its album, numbered", () => {
    const target = ytDownloadTarget(ROOT, {
      title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
      artist: "Daft Punk, Pharrell Williams & Nile Rodgers",
      album: "Random Access Memories",
      albumArtist: "Daft Punk",
      trackNumber: 8,
      discNumber: null,
    });
    assert.deepEqual(target, {
      folder: "/storage/emulated/0/Music/Daft Punk/Random Access Memories",
      fileName: "08 Get Lucky (feat. Pharrell Williams and Nile Rodgers).mp3",
      path: "/storage/emulated/0/Music/Daft Punk/Random Access Memories/08 Get Lucky (feat. Pharrell Williams and Nile Rodgers).mp3",
    });
  });

  const place = {
    title: "Song",
    artist: "Artist",
    album: "Album",
    albumArtist: "Artist",
    trackNumber: null,
  };

  test("without a track number, the file is named after the title alone", () => {
    const target = ytDownloadTarget(ROOT, {
      title: "Instant Crush",
      artist: "Daft Punk, Julian Casablancas",
      album: "Random Access Memories",
      albumArtist: "Daft Punk",
      trackNumber: null,
    });
    assert.equal(target.path, `${ROOT}/Daft Punk/Random Access Memories/Instant Crush.mp3`);
  });

  test("YouTube Music's audio is named the same way, as the M4A it's served in", () => {
    assert.equal(
      ytDownloadTarget(ROOT, { ...place, trackNumber: 3 }, "youtube").fileName,
      "03 Song.m4a",
    );
    assert.equal(ytDownloadTarget(ROOT, place, "youtube").path, `${ROOT}/Artist/Album/Song.m4a`);
    const long = ytDownloadTarget(ROOT, { ...place, title: "a".repeat(300) }, "youtube");
    assert.equal(long.fileName, `${"a".repeat(MAX_NAME_BYTES - 4)}.m4a`);
  });

  test("swaps characters Android's storage can't take in names for an underscore", () => {
    const target = ytDownloadTarget(ROOT, {
      ...place,
      title: 'Who? "Me": <a|b> *now*\\',
      albumArtist: "AC/DC",
      album: "Back\tin Black",
    });
    assert.equal(target.folder, `${ROOT}/AC_DC/Back_in Black`);
    assert.equal(target.fileName, "Who_ _Me__ _a_b_ _now__.mp3");
  });

  test("never makes a hidden name or one ending in a dot or space", () => {
    const target = ytDownloadTarget(ROOT, {
      ...place,
      title: "...Baby One More Time",
      albumArtist: ".hack ",
      album: "Vol. 2. ",
    });
    assert.equal(target.folder, `${ROOT}/hack/Vol. 2`);
    assert.equal(target.fileName, "Baby One More Time.mp3");
  });

  test("names a folder or file that would be empty Unknown", () => {
    const target = ytDownloadTarget(ROOT, { ...place, title: "...", albumArtist: " / " });
    assert.equal(target.folder, `${ROOT}/_/Album`);
    assert.equal(target.fileName, "Unknown.mp3");
  });

  test("without an album, the song sits in its artist's folder", () => {
    const target = ytDownloadTarget(ROOT, { ...place, album: null, albumArtist: null });
    assert.equal(target.path, `${ROOT}/Artist/Song.mp3`);
  });

  test("shortens long names to what the storage allows, counting bytes", () => {
    const long = ytDownloadTarget(ROOT, { ...place, title: "a".repeat(300), trackNumber: 1 });
    assert.equal(long.fileName, `01 ${"a".repeat(MAX_NAME_BYTES - 3 - 4)}.mp3`);
    const wide = ytDownloadTarget(ROOT, { ...place, title: "音".repeat(200) });
    assert.ok(utf8Length(wide.fileName) <= MAX_NAME_BYTES);
    assert.ok(wide.fileName.endsWith("音.mp3"));
    const folder = ytDownloadTarget(ROOT, { ...place, album: "b".repeat(400) });
    assert.equal(folder.folder.split("/").at(-1), "b".repeat(MAX_NAME_BYTES));
  });
});
