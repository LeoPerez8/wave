import assert from "node:assert/strict";
import { test } from "node:test";

import {
  soulseekCandidates,
  soulseekQuery,
  soulseekReceivedMatches,
  soulseekSameRecording,
  ytDownloadSharedJob,
  type SoulseekCandidate,
  type YtDownloadJournalJob,
  type YtSong,
} from "./index.ts";

const song: YtSong = {
  videoId: "requested",
  title: "Get Lucky",
  artists: ["Daft Punk", "Pharrell Williams"],
  album: "Random Access Memories",
  durationMs: 370_000,
  artworkUrl: null,
  explicit: false,
};
const peer = (filename: string, patch: Partial<SoulseekCandidate> = {}): SoulseekCandidate => ({
  username: "peer",
  filename,
  bytes: 14_800_000,
  bitrateKbps: 320,
  durationMs: 370_000,
  freeSlot: true,
  uploadSpeed: 100_000,
  queueLength: 0,
  ...patch,
});

test("Download accepts the exact recording and refuses guest-only, radio and live alternatives", () => {
  const exact = peer("Daft Punk\\Random Access Memories\\08 - Get Lucky.mp3");
  assert.deepEqual(
    soulseekCandidates(song, [
      peer("Pharrell Williams - Get Lucky.mp3"),
      peer("Daft Punk - Get Lucky (Radio Edit).mp3"),
      peer("Daft Punk\\Live in Paris\\08 - Get Lucky.mp3"),
      exact,
    ]),
    [exact],
  );
});

test("automatic choice ranks recording evidence before availability, removes duplicate peer reports and bounds retries", () => {
  const exact = peer("Daft Punk\\Random Access Memories\\08 - Get Lucky.mp3", {
    username: "album",
    freeSlot: false,
    queueLength: 10,
  });
  const fast = peer("Daft Punk - Get Lucky.mp3", { username: "fast", uploadSpeed: 1_000_000 });
  const waiting = peer("Daft Punk - Get Lucky.mp3", {
    username: "waiting",
    freeSlot: false,
    queueLength: 2,
  });
  const unknown = peer("Daft Punk - Get Lucky.mp3", { username: "unknown", durationMs: null });
  assert.deepEqual(
    soulseekCandidates(song, [
      unknown,
      waiting,
      fast,
      exact,
      exact,
      peer("Daft Punk - Get Lucky.mp3", { bitrateKbps: 128 }),
    ]),
    [exact, fast, waiting],
  );
  assert.deepEqual(soulseekCandidates({ ...song, durationMs: null }, [unknown]), []);
});

test("received tags and actual duration are checked before trusted tags replace them", () => {
  assert.equal(
    soulseekReceivedMatches(
      song,
      { title: "Get Lucky (Live)", artist: "Daft Punk", album: null },
      370_000,
    ),
    false,
  );
  assert.equal(
    soulseekReceivedMatches(
      song,
      { title: "Get Lucky", artist: "Pharrell Williams", album: null },
      370_000,
    ),
    false,
  );
  assert.equal(
    soulseekReceivedMatches(
      song,
      { title: "Get Lucky", artist: "Daft Punk", album: "Live in Paris" },
      370_000,
    ),
    false,
  );
  assert.equal(
    soulseekReceivedMatches(song, { title: null, artist: null, album: null }, 380_000),
    false,
  );
  assert.equal(
    soulseekReceivedMatches(song, { title: null, artist: null, album: null }, 371_000),
    true,
  );
  assert.equal(
    soulseekReceivedMatches(
      song,
      { title: "Get Lucky", artist: "Daft Punk, Pharrell Williams", album: "Compilation" },
      370_000,
    ),
    true,
  );
  // The artist tag splits into artists as the Library splits credits.
  assert.equal(
    soulseekReceivedMatches(
      song,
      { title: "Get Lucky", artist: "Daft Punk; Pharrell Williams", album: null },
      370_000,
    ),
    true,
  );
  assert.equal(
    soulseekReceivedMatches(
      song,
      { title: "Get Lucky", artist: "Daft Punk with Pharrell Williams", album: null },
      370_000,
    ),
    true,
  );
  // A vinyl rip's title tag may start with its side.
  assert.equal(
    soulseekReceivedMatches(
      song,
      { title: "A2 Get Lucky", artist: "Daft Punk", album: null },
      370_000,
    ),
    true,
  );
  assert.equal(
    soulseekReceivedMatches(
      song,
      { title: "A2 Lose Yourself", artist: "Daft Punk", album: null },
      370_000,
    ),
    false,
  );
});

test("different result ids join only a known same recording without collapsing editions or guests", () => {
  assert.equal(
    soulseekSameRecording(song, { ...song, videoId: "other", durationMs: 372_000 }),
    true,
  );
  assert.equal(soulseekSameRecording(song, { ...song, videoId: "other", durationMs: null }), false);
  assert.equal(
    soulseekSameRecording(song, { ...song, videoId: "other", title: "Get Lucky (Radio Edit)" }),
    false,
  );
  assert.equal(
    soulseekSameRecording(song, { ...song, videoId: "other", artists: ["Pharrell Williams"] }),
    false,
  );
  assert.equal(
    soulseekSameRecording(song, {
      ...song,
      videoId: "other",
      artists: ["Daft Punk", "Different Guest"],
    }),
    false,
  );
});

test("simultaneous result ids share one journal job while duration chains cannot widen identity", () => {
  const second = { ...song, videoId: "second", durationMs: 372_000 };
  const third = { ...song, videoId: "third", durationMs: 374_000 };
  const requested: YtDownloadJournalJob = { id: "requested", song, phase: "transferring" };
  assert.equal(ytDownloadSharedJob([requested], second), "requested");
  const shared = { ...requested, aliases: [second] };
  // 374 s is within tolerance of 372 s but not of the requested 370 s.
  assert.equal(ytDownloadSharedJob([shared], third), null);
  assert.equal(ytDownloadSharedJob([{ ...shared, phase: "failed" }], second), null);
  assert.equal(ytDownloadSharedJob([{ ...shared, phase: "cancelled" }], second), null);
  assert.equal(
    ytDownloadSharedJob([{ ...shared, phase: "completed", acknowledged: true }], second),
    null,
  );
});

test("normalized names keep full artist identity, ordinary title words and featured credits", () => {
  const cases = [
    {
      title: "Joga",
      artists: ["Bjork"],
      album: "Homogenic",
      file: "Björk\\Homogenic\\03 - Jóga.mp3",
    },
    {
      title: "Live Forever",
      artists: ["Oasis"],
      album: "Definitely Maybe",
      file: "Oasis - Live Forever.mp3",
    },
    {
      title: "The Boxer",
      artists: ["Simon & Garfunkel"],
      album: null,
      file: "Simon & Garfunkel - The Boxer.mp3",
    },
    { title: "Thunderstruck", artists: ["AC/DC"], album: null, file: "AC-DC - Thunderstruck.mp3" },
    {
      title: "Get Lucky (feat. Pharrell Williams)",
      artists: ["Daft Punk", "Pharrell Williams"],
      album: null,
      file: "Daft Punk ft Pharrell Williams - Get Lucky.mp3",
    },
  ];
  for (const item of cases) {
    const candidate = peer(item.file);
    assert.deepEqual(soulseekCandidates({ ...song, ...item }, [candidate]), [candidate], item.file);
  }
});

test("featured credits do not hide meaningful title text or a later edition", () => {
  assert.deepEqual(
    soulseekCandidates(song, [peer("Daft Punk feat. Different Guest - Get Lucky.mp3")]),
    [],
  );
  assert.deepEqual(
    soulseekCandidates(song, [peer("Daft Punk - Get Lucky (feat. Different Guest).mp3")]),
    [],
  );
  assert.deepEqual(
    soulseekCandidates(song, [peer("Daft Punk - Get Lucky (feat. Pharrell Williams) Pt. 2.mp3")]),
    [],
  );
  assert.deepEqual(
    soulseekCandidates(song, [peer("Daft Punk - Get Lucky (feat. Pharrell Williams) (Live).mp3")]),
    [],
  );
});

test("edition names, master years and meaningful title suffixes cannot be silently substituted", () => {
  const pairs = [
    ["Get Lucky (Timo Maas Remix)", "Get Lucky (Mike Shinoda Remix)"],
    ["Get Lucky (Live Aid 1985)", "Get Lucky (Live at Wembley)"],
    ["Get Lucky (2017 Remaster)", "Get Lucky (1999 Remaster)"],
    ["Get Lucky (2017 Remaster)", "Get Lucky"],
    ["Get Lucky", "Get Lucky (2011 Remaster)"],
    ["Get Lucky (Clean)", "Get Lucky (Explicit)"],
    ["Get Lucky", "Get Lucky Pt. 2"],
    ["Get Lucky", "Get Lucky (Acoustic)"],
    ["Get Lucky", "Get Lucky (Instrumental)"],
    ["Get Lucky (Extended Mix)", "Get Lucky (Radio Edit)"],
  ];
  for (const [requested, offered] of pairs) {
    assert.deepEqual(
      soulseekCandidates({ ...song, title: requested! }, [peer(`Daft Punk - ${offered}.mp3`)]),
      [],
      offered,
    );
  }
  const remix = peer("Daft Punk - Get Lucky (Timo Maas Remix).mp3");
  assert.deepEqual(soulseekCandidates({ ...song, title: "Get Lucky (Timo Maas Remix)" }, [remix]), [
    remix,
  ]);
  const remaster = peer("Daft Punk - Get Lucky (2017 Remaster).mp3");
  assert.deepEqual(
    soulseekCandidates(
      {
        ...song,
        title: "Get Lucky (2017 Remaster)",
        album: "Random Access Memories (2017 Remaster)",
      },
      [remaster],
    ),
    [remaster],
  );
});

test("no match, unsupported quality and invalid advertised values have no eligible download", () => {
  assert.deepEqual(soulseekCandidates(song, []), []);
  assert.deepEqual(
    soulseekCandidates(song, [
      peer("Daft Punk - Get Lucky.mp3", { durationMs: 380_000 }),
      peer("Daft Punk - Get Lucky.flac", { bitrateKbps: null }),
      peer("Daft Punk - Get Lucky.mp3", { bitrateKbps: 192 }),
      peer("Daft Punk - Get Lucky.mp3", { bytes: Number.NaN }),
      peer("Daft Punk\\Get Lucky\\B - Different Song.mp3"),
    ]),
    [],
  );
});

test("an artist or title that starts with a number isn't taken for a track number", () => {
  const by = (artist: string, title: string): YtSong => ({
    ...song,
    title,
    artists: [artist],
    album: null,
    durationMs: 230_000,
  });
  const file = (filename: string) => peer(filename, { durationMs: 230_000 });
  for (const [artist, title, filename] of [
    ["50 Cent", "In Da Club", "50 Cent - In Da Club.mp3"],
    ["21 Savage", "a lot", "Music/21 Savage - a lot.mp3"],
    ["3 Doors Down", "Kryptonite", "3 Doors Down - Kryptonite.mp3"],
    ["30 Seconds to Mars", "The Kill", "30 Seconds to Mars - The Kill.mp3"],
    ["50 Cent", "In Da Club", "03 - 50 Cent - In Da Club.mp3"],
    ["3 Doors Down", "Kryptonite", "3 Doors Down/The Better Life/01 Kryptonite.mp3"],
    ["Ariana Grande", "7 rings", "Ariana Grande/thank u, next/04. 7 rings.mp3"],
    ["Ariana Grande", "7 rings", "Ariana Grande - 7 rings.mp3"],
  ] as const) {
    assert.equal(soulseekCandidates(by(artist, title), [file(filename)]).length, 1, filename);
  }
  assert.deepEqual(
    soulseekCandidates(by("50 Cent", "In Da Club"), [file("Cent - In Da Club.mp3")]),
    [],
  );
});

test("common folder and file layouts still name the recording", () => {
  const coldplay = (title: string, album: string, durationMs: number): YtSong => ({
    ...song,
    title,
    artists: ["Coldplay"],
    album,
    durationMs,
  });
  const cemeteries = coldplay("Cemeteries of London", "Viva La Vida", 202_000);
  for (const [recording, filename, durationMs] of [
    // An artist folder telling two artists apart.
    [cemeteries, "Coldplay (UK)/2008 - Viva La Vida/02 - Cemeteries Of London.mp3", 201_000],
    // A vinyl rip's side after the track number.
    [cemeteries, "Coldplay/Viva La Vida/02 A2 Cemeteries Of London.mp3", 201_000],
    // An underscore after the track number.
    [coldplay("White Shadows", "X&Y", 329_000), "Coldplay/X&Y/03_White Shadows.mp3", 330_000],
    // An album folder that names the artist.
    [
      coldplay("Always in My Head", "Ghost Stories", 217_000),
      "!!unsorted/Coldplay - Ghost Stories - 2014/01. Always In My Head.mp3",
      216_000,
    ],
  ] as const) {
    assert.equal(
      soulseekCandidates(recording, [peer(filename, { durationMs })]).length,
      1,
      filename,
    );
  }
});

test("those layouts don't let another artist, side or edition through", () => {
  const cemeteries: YtSong = {
    ...song,
    title: "Cemeteries of London",
    artists: ["Coldplay"],
    album: "Viva La Vida or Death and All His Friends",
    durationMs: 202_000,
  };
  const file = (filename: string) => peer(filename, { durationMs: 201_000 });
  assert.deepEqual(
    soulseekCandidates(cemeteries, [
      file("Coldplay Tribute (UK)/Viva La Vida/02 - Cemeteries Of London.mp3"),
      file("Coldplay (Live)/Viva La Vida/02 - Cemeteries Of London (Live).mp3"),
      file("Vitamin String Quartet - Viva La Vida/02 Cemeteries of London.mp3"),
      file("Coldplay/Viva La Vida/02 A2 Lost.mp3"),
    ]),
    [],
  );
  // A title that starts like a vinyl side keeps it.
  const bomber: YtSong = { ...cemeteries, title: "B2 Bomber", album: null };
  assert.equal(soulseekCandidates(bomber, [file("Coldplay/Singles/05 B2 Bomber.mp3")]).length, 1);
});

test("the search asks for the artist and title words every matching file name has", () => {
  const query = (title: string, artists: readonly string[]) =>
    soulseekQuery({ ...song, title, artists });
  assert.equal(query("Get Lucky (feat. Pharrell Williams)", ["Daft Punk"]), "Daft Punk Get Lucky");
  assert.equal(query("Get Lucky", ["Daft Punk feat. Pharrell Williams"]), "Daft Punk Get Lucky");
  assert.equal(query("Something - Remastered 2009", ["The Beatles"]), "The Beatles Something");
  assert.equal(query("Bohemian Rhapsody (Remastered 2011)", ["Queen"]), "Queen Bohemian Rhapsody");
  assert.equal(query("Halo", ["Beyoncé"]), "Beyoncé Halo");
  assert.equal(query("Back In Black", ["AC/DC"]), "AC DC Back In Black");
  // Peers split "Don't" differently; leaving such words out still finds the file.
  assert.equal(query("Don't Stop Me Now", ["Queen"]), "Queen Stop Me Now");
  assert.equal(query("Hey, Soul Sister!", ["Train"]), "Train Hey Soul Sister");
  // A title meaning something different keeps its words.
  assert.equal(
    query("Mr. Brightside - Jacques Lu Cont Remix", ["The Killers"]),
    "The Killers Mr Brightside",
  );
  assert.equal(query("Part 2 - Interlude", ["Band"]), "Band Part 2 Interlude");
});
