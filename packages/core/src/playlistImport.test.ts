import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  finishPlaylistImport,
  importLogLine,
  planLinkImport,
  playlistImportView,
  queuePlaylistImport,
  readPlaylistImports,
  startPlaylistImport,
  updatePlaylistImport,
  withoutPlaylistImport,
  writePlaylistImports,
  writePlaylistYtSong,
  type PlaylistImport,
  type PlaylistImports,
  type SpotifySong,
  type YtSong,
} from "./index.ts";

const yt = (videoId: string, title: string, fields: Partial<YtSong> = {}): YtSong => ({
  videoId,
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 369_000,
  artworkUrl: null,
  explicit: false,
  ...fields,
});

const spotify = (title: string, fields: Partial<SpotifySong> = {}): SpotifySong => ({
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 369_000,
  ...fields,
});

/** [song] as it goes into the playlist when nothing has searched it: unsearched, in its place. */
const unsearched = (song: SpotifySong | undefined) => {
  assert.ok(song);
  return { source: "unsearched", song: { artworkUrl: null, ...song } };
};

/** [song] as it goes into the playlist when it isn't found: unavailable, in its place. */
const unavailable = (
  song: SpotifySong | undefined,
  reason: "notFound" | "localFile" = "notFound",
) => {
  assert.ok(song);
  return { source: "unavailable", song: { artworkUrl: null, ...song, reason } };
};

const library = [
  { id: 1, title: "Giorgio by Moroder", artist: "Daft Punk", durationMs: 544_000 },
  { id: 2, title: "Touch", artist: "Daft Punk", durationMs: 498_000 },
];

const ytPlaylist = (
  songs: readonly YtSong[],
  title = "Late Night",
  repeats: readonly YtSong[] = [],
) => ({
  service: "ytMusic" as const,
  playlist: { title, artworkUrl: null, songs, repeats, truncated: false },
});

const spotifyPlaylist = (
  songs: readonly SpotifySong[],
  title = "Late Night",
  total = songs.length,
) => ({
  service: "spotify" as const,
  playlist: { title, artworkUrl: null, songs, truncated: false, total },
});

/** Imports [listed] from Spotify into playlist 7: what the playlist is given, and the import once done. */
const importSpotify = (listed: readonly SpotifySong[], total = listed.length) => {
  const plan = planLinkImport(spotifyPlaylist(listed, "Late Night", total), library);
  const { songs, job } = finishPlaylistImport(
    startPlaylistImport(plan, { playlistId: 7, name: "Late Night" }),
  );
  return { plan, given: songs, job };
};

describe("a YouTube Music playlist import", () => {
  test("the playlist gets every song at once, in the source's order, the Library's as its tracks", () => {
    const plan = planLinkImport(
      ytPlaylist([
        yt("a", "Giorgio by Moroder", { durationMs: 544_000 }),
        yt("b", "Within", { durationMs: 228_000 }),
        yt("c", "Touch", { durationMs: 498_000 }),
      ]),
      library,
    );
    const job = startPlaylistImport(plan, { playlistId: 7, name: "Late Night" });
    const { songs, job: after } = finishPlaylistImport(job);
    assert.deepEqual(songs, [
      { source: "library", trackId: 1 },
      { source: "stream", song: yt("b", "Within", { durationMs: 228_000 }) },
      { source: "library", trackId: 2 },
    ]);
    assert.equal(after.state.kind, "done");
    assert.deepEqual(finishPlaylistImport(after).songs, []);
  });

  test("a song that comes twice, or two that are one Library song, goes in once", () => {
    const plan = planLinkImport(
      ytPlaylist([
        yt("a", "Touch", { durationMs: 498_000 }),
        yt("b", "Within"),
        yt("c", "Touch (feat. Paul Williams)", { durationMs: 498_000 }),
        yt("b", "Within"),
      ]),
      library,
    );
    const { songs } = finishPlaylistImport(
      startPlaylistImport(plan, { playlistId: 7, name: "Late Night" }),
    );
    assert.deepEqual(songs, [
      { source: "library", trackId: 2 },
      { source: "stream", song: yt("b", "Within") },
    ]);
    assert.equal(plan.songs.length, 2, "the card counts each song once");
    assert.equal(plan.inLibrary, 1);
  });

  test("names the rows listed again and the songs that are one Library song, which add up to its rows", () => {
    const plan = planLinkImport(
      ytPlaylist(
        [
          yt("a", "Touch", { durationMs: 498_000 }),
          yt("b", "Within"),
          yt("c", "Touch (feat. Paul Williams)", { durationMs: 498_000 }),
        ],
        "Late Night",
        [yt("b", "Within")],
      ),
      library,
    );
    assert.equal(plan.sourceTotal, 4);
    assert.deepEqual(plan.leftOut, [
      {
        song: spotify("Touch (feat. Paul Williams)", { durationMs: 498_000 }),
        reason: "listedTwice",
      },
      { song: spotify("Within"), reason: "listedTwice" },
    ]);
    assert.equal(plan.songs.length + plan.leftOut.length + plan.notSongs, 4);
  });
});

describe("a Spotify playlist import", () => {
  const songs = [
    spotify("Giorgio by Moroder", { durationMs: 544_000 }),
    spotify("Within", { durationMs: 228_000, artworkUrl: "https://i.scdn.co/image/within" }),
    spotify("Instant Crush", { artists: ["Daft Punk", "Julian Casablancas"], durationMs: 337_000 }),
    spotify("Untitled", { artists: [] }),
    spotify("Within", { durationMs: 228_000, artworkUrl: "https://i.scdn.co/image/within" }),
    spotify("Touch", { durationMs: 498_000 }),
  ];

  test("makes the playlist whole at once: the Library's songs as its own, the others unsearched", () => {
    const { given, job } = importSpotify(songs);
    assert.deepEqual(given, [
      { source: "library", trackId: 1 },
      unsearched(songs[1]),
      unsearched(songs[2]),
      unavailable(songs[3], "localFile"),
      { source: "library", trackId: 2 },
    ]);
    assert.equal(job.state.kind, "done");
  });

  test("an unsearched song keeps what Spotify listed, its cover included", () => {
    const [, within] = importSpotify(songs).given;
    assert.deepEqual(within, {
      source: "unsearched",
      song: {
        title: "Within",
        artists: ["Daft Punk"],
        album: "Random Access Memories",
        durationMs: 228_000,
        artworkUrl: "https://i.scdn.co/image/within",
      },
    });
  });

  test("the plan says where each song goes, before anything is searched", () => {
    const plan = planLinkImport(spotifyPlaylist(songs), library);
    assert.deepEqual(plan.finds, [
      { kind: "library", trackId: 1 },
      { kind: "unsearched" },
      { kind: "unsearched" },
      { kind: "notFound" },
      { kind: "library", trackId: 2 },
    ]);
    assert.equal(plan.inLibrary, 2);
  });

  test("a large playlist goes in whole, each song listed twice once", () => {
    const listed = Array.from({ length: 2451 }, (_, index) =>
      spotify(`Song ${index % 2430}`, { durationMs: 200_000 + (index % 2430) }),
    );
    const { given, job, plan } = importSpotify(listed);
    assert.equal(given.length, 2430);
    assert.equal(plan.leftOut.length, 21);
    assert.equal(playlistImportView([job], 7)?.line, "21 songs were listed twice");
  });
});

describe("a Spotify playlist listing a song more than once", () => {
  test("counts it once, and imports it once", () => {
    const plan = planLinkImport(
      spotifyPlaylist([
        spotify("Touch", { durationMs: 498_000 }),
        spotify("Within", { durationMs: 228_000 }),
        spotify("Touch", { durationMs: 498_000 }),
        spotify("Within", { durationMs: 228_000 }),
        spotify("Within", { durationMs: 228_000 }),
        spotify("Untitled", { artists: [] }),
        spotify("Untitled", { artists: [] }),
        spotify("Within (Live)", { durationMs: 228_000 }),
      ]),
      library,
    );
    assert.deepEqual(
      plan.songs.map((song) => song.title),
      ["Touch", "Within", "Untitled", "Within (Live)"],
    );
    assert.equal(plan.inLibrary, 1);
  });

  test("names each song listed twice, so the songs imported and those add up to Spotify's count", () => {
    const plan = planLinkImport(
      spotifyPlaylist([
        spotify("Touch", { durationMs: 498_000 }),
        spotify("Within", { durationMs: 228_000 }),
        spotify("Touch (feat. Paul Williams)", { durationMs: 498_000 }),
        spotify("Within", { durationMs: 228_000 }),
        spotify("Within (Live)", { durationMs: 228_000 }),
      ]),
      library,
    );
    assert.equal(plan.sourceTotal, 5);
    assert.deepEqual(plan.leftOut, [
      {
        song: spotify("Touch (feat. Paul Williams)", { durationMs: 498_000 }),
        reason: "listedTwice",
      },
      { song: spotify("Within", { durationMs: 228_000 }), reason: "listedTwice" },
    ]);
    assert.equal(plan.songs.length + plan.leftOut.length, 5);
  });

  test("counts the items Spotify lists that aren't songs, such as podcast episodes", () => {
    const listed = [spotify("Touch"), spotify("Within"), spotify("Within")];
    const plan = planLinkImport(spotifyPlaylist(listed, "Late Night", 5), library);
    assert.equal(plan.sourceTotal, 5);
    assert.equal(plan.notSongs, 2);
    assert.equal(plan.songs.length + plan.leftOut.length + plan.notSongs, 5);
  });

  test("a playlist only partly read counts what was read", () => {
    const listed = [spotify("Touch"), spotify("Within"), spotify("Within")];
    const { playlist } = spotifyPlaylist(listed, "Late Night", 2451);
    const plan = planLinkImport(
      { service: "spotify", playlist: { ...playlist, truncated: true } },
      library,
    );
    assert.equal(plan.sourceTotal, 3);
    assert.equal(plan.notSongs, 0);
  });
});

describe("the app log of an import", () => {
  test("says the source, the name and where its songs went, in one line", () => {
    const { job } = importSpotify([
      spotify("Giorgio by Moroder", { durationMs: 544_000 }),
      spotify("Within"),
      spotify("Within"),
      spotify("Untitled", { artists: [] }),
    ]);
    assert.equal(
      importLogLine(job, { resumed: false }),
      'Import of "Late Night" from Spotify done at once: 3 songs: 1 from the Library, 1 unsearched, 1 unavailable, 1 listed twice',
    );
    const ytJob = startPlaylistImport(planLinkImport(ytPlaylist([yt("b", "Within")]), library), {
      playlistId: 7,
      name: "Mix",
    });
    assert.equal(
      importLogLine(ytJob, { resumed: false }),
      'Import of "Mix" from YouTube Music done at once: 1 song: 0 from the Library, 1 from YouTube Music, 0 unavailable',
    );
  });
});

describe("the songs an import left out", () => {
  const songs = [
    spotify("Giorgio by Moroder", { durationMs: 544_000 }),
    spotify("Within", { durationMs: 228_000 }),
    spotify("Untitled", { artists: [] }),
    spotify("Touch", { durationMs: 498_000 }),
    spotify("Within", { durationMs: 228_000 }),
    spotify("Doin' it Right", { artists: ["Daft Punk", "Panda Bear"], durationMs: 251_000 }),
    spotify("Touch (feat. Paul Williams)", { durationMs: 498_000 }),
  ];
  const leftOut = (job: PlaylistImport<YtSong>) => playlistImportView([job], 7)?.leftOut;

  test("lists the songs listed twice; the others are all in the playlist", () => {
    const { job, given } = importSpotify(songs);
    assert.equal(playlistImportView([job], 7)?.line, "2 songs were listed twice");
    assert.deepEqual(leftOut(job), {
      title: "2 songs were listed twice",
      message: "Each went into Late Night once.",
      sections: [
        {
          heading: "Listed twice",
          songs: ["Within · Daft Punk", "Touch (feat. Paul Williams) · Daft Punk"],
        },
      ],
    });
    assert.deepEqual(given, [
      { source: "library", trackId: 1 },
      unsearched(songs[1]),
      unavailable(songs[2], "localFile"),
      { source: "library", trackId: 2 },
      unsearched(songs[5]),
    ]);
  });

  test("the playlist's songs, those listed twice and those not songs add up to Spotify's count", () => {
    const { plan, job, given } = importSpotify(songs, 8);
    const twice = leftOut(job)?.sections[0]?.songs.length ?? 0;
    assert.deepEqual([given.length, twice, plan.notSongs], [5, 2, 1]);
    assert.equal(given.length + twice + plan.notSongs, 8);
  });

  test("shown until dismissed, while the songs go in it shows nothing", () => {
    const plan = planLinkImport(spotifyPlaylist(songs), library);
    const going = startPlaylistImport(plan, { playlistId: 7, name: "Late Night" });
    let imports = queuePlaylistImport([], going);
    assert.equal(playlistImportView(imports, 7), null);
    imports = updatePlaylistImport(imports, finishPlaylistImport(going).job);
    assert.equal(playlistImportView(imports, 7)?.line, "2 songs were listed twice");
    assert.deepEqual(withoutPlaylistImport(imports, 7), []);
  });

  test("with no song listed twice, nothing is left to show", () => {
    const { job } = importSpotify(songs.slice(0, 3));
    assert.equal(playlistImportView([job], 7), null);
    assert.deepEqual(updatePlaylistImport(queuePlaylistImport([], job), job), []);
  });

  test("the songs listed twice are kept while Wave is closed", () => {
    const { job } = importSpotify(songs);
    const [read] = readPlaylistImports(writePlaylistImports([job]));
    assert.ok(read);
    assert.deepEqual(leftOut(read), leftOut(job));
  });

  test("importing into a playlist again replaces its import", () => {
    const { job } = importSpotify(songs);
    const again = queuePlaylistImport([job], { ...job, name: "Again" });
    assert.deepEqual(
      again.map((queued) => queued.name),
      ["Again"],
    );
  });
});

/**
 * An import as a Wave from before Spotify imports stopped searching kept it:
 * [finds] null for each song still to be searched, given the playlist up to
 * [added], [state] going on, stopped or done. [version] none for one kept
 * before unavailable entries.
 */
const keptBefore = (
  songs: readonly SpotifySong[],
  finds: readonly unknown[],
  { added, state, version = 2 }: { added: number; state: unknown; version?: number | null },
): string =>
  JSON.stringify({
    ...(version === null ? {} : { version }),
    imports: [
      {
        playlistId: 7,
        name: "Late Night",
        service: "spotify",
        songs,
        finds,
        leftOut: [],
        added,
        state,
      },
    ],
  });

describe("an import going on when Spotify imports stopped searching", () => {
  const songs = [
    spotify("Giorgio by Moroder", { durationMs: 544_000 }),
    spotify("Within", { durationMs: 228_000 }),
    spotify("Doin' it Right", { artists: ["Daft Punk", "Panda Bear"], durationMs: 251_000 }),
    spotify("Fragments of Time", { album: null, durationMs: 279_000, artworkUrl: "cover" }),
  ];
  const within = yt("w", "Within", { durationMs: 228_000 });
  const finds = [
    { kind: "library", trackId: 1 },
    { kind: "ytMusic", song: writePlaylistYtSong(within) },
    null,
    { kind: "notFound" },
  ];

  test("ends at once: the songs found stay as found, the rest go in unsearched, in their places", () => {
    for (const state of [{ kind: "importing" }, { kind: "stopped", reason: "offline" }]) {
      const [read] = readPlaylistImports(keptBefore(songs, finds, { added: 1, state }));
      assert.ok(read);
      const { songs: given, job } = finishPlaylistImport(read);
      assert.deepEqual(given, [
        { source: "stream", song: { ...within, albumId: null } },
        unsearched(songs[2]),
        unavailable(songs[3]),
      ]);
      assert.equal(job.state.kind, "done");
      assert.deepEqual(updatePlaylistImport([read], job), [], "nothing left to show");
      assert.equal(
        importLogLine(job, { resumed: true }),
        'Import of "Late Night" from Spotify, kept from before the update, ended as Wave started: 4 songs: 1 from the Library, 1 from YouTube Music, 1 unsearched, 1 unavailable',
      );
    }
  });

  test("songs it gave the playlist before aren't given again", () => {
    const [read] = readPlaylistImports(
      keptBefore(songs, finds, { added: 3, state: { kind: "importing" } }),
    );
    assert.ok(read);
    assert.deepEqual(finishPlaylistImport(read).songs, [unavailable(songs[3])]);
  });

  test("nothing kept, or nothing readable, is no import", () => {
    assert.deepEqual(readPlaylistImports(null), []);
    assert.deepEqual(readPlaylistImports("{"), []);
    assert.deepEqual(readPlaylistImports('{"imports":[{"playlistId":"7"}]}'), []);
  });
});

describe("an import kept by a Wave from before unavailable entries", () => {
  const songs = [
    spotify("Giorgio by Moroder", { durationMs: 544_000 }),
    spotify("Within", { durationMs: 228_000 }),
    spotify("Untitled", { artists: [] }),
    spotify("Touch", { durationMs: 498_000 }),
    spotify("Doin' it Right", { artists: ["Daft Punk", "Panda Bear"], durationMs: 251_000 }),
  ];
  const within = writePlaylistYtSong(yt("w", "Within", { durationMs: 228_000 }));
  const view = (imports: PlaylistImports<YtSong>) => playlistImportView(imports, 7);
  const done = { kind: "done" };

  test("done, it still names the songs it didn't find, which never went in", () => {
    const finds = [
      { kind: "library", trackId: 1 },
      { kind: "ytMusic", song: within },
      { kind: "notFound" },
    ];
    const read = readPlaylistImports(
      keptBefore(songs.slice(0, 3), finds, { added: 3, state: done, version: null }),
    );
    assert.deepEqual(view(read)?.leftOut, {
      title: "1 song wasn't found",
      message: "Late Night was imported without it.",
      sections: [{ heading: "Not found", songs: ["Untitled · Unknown Artist"] }],
    });
    const again = readPlaylistImports(writePlaylistImports(read));
    assert.deepEqual(view(again)?.leftOut, view(read)?.leftOut, "kept again, it still names them");
  });

  test("done with nothing to name, it's gone", () => {
    const finds = [
      { kind: "library", trackId: 1 },
      { kind: "ytMusic", song: within },
    ];
    const kept = keptBefore(songs.slice(0, 2), finds, { added: 2, state: done, version: null });
    assert.deepEqual(readPlaylistImports(kept), []);
  });

  test("going on, the songs it passed over are named; those after go in as this Wave puts them", () => {
    const finds = [
      { kind: "library", trackId: 1 },
      { kind: "notFound" },
      { kind: "ytMusic", song: within },
      { kind: "notFound" },
      null,
    ];
    const listed = [songs[0], songs[4], songs[1], songs[2], songs[3]] as SpotifySong[];
    const [read] = readPlaylistImports(
      keptBefore(listed, finds, { added: 3, state: { kind: "importing" }, version: null }),
    );
    assert.ok(read);
    const finished = finishPlaylistImport(read);
    assert.deepEqual(finished.songs, [unavailable(songs[2], "localFile"), unsearched(songs[3])]);
    assert.deepEqual(view(updatePlaylistImport([read], finished.job))?.leftOut?.sections, [
      { heading: "Not found", songs: ["Doin' it Right · Daft Punk & Panda Bear"] },
    ]);
  });
});
