import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanupPlan, genreTagPlan, movePlan, type FolderFile, type MovePlan } from "./plan.ts";

const file = (
  path: string,
  tags: FolderFile["tags"] = {},
  more: Partial<FolderFile> = {},
): FolderFile => ({
  path,
  sizeBytes: 1000,
  durationMs: 200_000,
  tags: { title: "Song", artist: "Artist", album: "Album", ...tags },
  ...more,
});

describe("genreTagPlan", () => {
  it("gives a file without a genre its genre folder's name", () => {
    const plan = genreTagPlan([file("Rock BR/Legião Urbana - Tempo Perdido.mp3")]);
    assert.deepEqual(plan, [
      { path: "Rock BR/Legião Urbana - Tempo Perdido.mp3", genre: "Rock BR" },
    ]);
  });

  it("keeps a genre the file has, and writes over a blank one", () => {
    const plan = genreTagPlan([
      file("Rock/Kept.mp3", { genre: "Classic Rock" }),
      file("Pop/Blank.mp3", { genre: "  " }),
    ]);
    assert.deepEqual(plan, [{ path: "Pop/Blank.mp3", genre: "Pop" }]);
  });

  it("leaves files outside a genre folder alone", () => {
    const plan = genreTagPlan([
      file(".thumbnails/Song.mp3"),
      file("YT Music/Artist/Album/01 Song.mp3"),
      file("Loose.mp3"),
      file("Artist/Album/01 Song.mp3"),
      file("Artist/No Album Song.mp3"),
    ]);
    assert.deepEqual(plan, []);
  });
});

const destinations = (files: readonly FolderFile[]): Record<string, string> =>
  Object.fromEntries(movePlan(files, new Map()).moves.map((move) => [move.from, move.to]));

describe("movePlan", () => {
  it("moves each song where a download of it would go", () => {
    const moves = destinations([
      file("Pop/a.mp3", {
        title: "Bad Guy",
        artist: "Billie Eilish",
        album: "WWAFAWDWG?",
        trackNumber: "2/14",
      }),
      file("Rock/b.mp3", {
        title: "Numb",
        artist: "Linkin Park",
        album: "Meteora",
        albumArtist: "Linkin Park",
      }),
      file("Kpop/c.mp3", {
        title: "Hit",
        artist: "Someone",
        album: "Hits 2020",
        compilation: true,
      }),
    ]);
    assert.deepEqual(moves, {
      "Pop/a.mp3": "Billie Eilish/WWAFAWDWG_/02 Bad Guy.mp3",
      "Rock/b.mp3": "Linkin Park/Meteora/Numb.mp3",
      "Kpop/c.mp3": "Various Artists/Hits 2020/Hit.mp3",
    });
  });

  it("files a collaboration without an album artist under its primary artist", () => {
    const moves = destinations([
      file("Pop/a.mp3", {
        title: "Señorita",
        artist: "Shawn Mendes, Camila Cabello",
        album: "Señorita",
      }),
      file("Pop/e.mp3", { title: "Stitches", artist: "Shawn Mendes", album: "Handwritten" }),
      file("Pop/b.mp3", { title: "Love", artist: "Earth, Wind & Fire", album: "Best" }),
      file("Rap/c.mp3", {
        title: "Track",
        artist: "Tyler, The Creator feat. Kali Uchis",
        album: "Flower Boy",
      }),
      file("Rap/d.mp3", { title: "Other", artist: "Tyler, The Creator", album: "Flower Boy" }),
    ]);
    assert.deepEqual(moves, {
      "Pop/a.mp3": "Shawn Mendes/Señorita/Señorita.mp3",
      "Pop/e.mp3": "Shawn Mendes/Handwritten/Stitches.mp3",
      "Pop/b.mp3": "Earth, Wind & Fire/Best/Love.mp3",
      "Rap/c.mp3": "Tyler, The Creator/Flower Boy/Track.mp3",
      "Rap/d.mp3": "Tyler, The Creator/Flower Boy/Other.mp3",
    });
  });

  const fire = { title: "Be My Fire", artist: "The Blue Stones", album: "Black Holes" };

  it("keeps the copy outside .thumbnails and deletes the other", () => {
    const plan = movePlan(
      [
        file(".thumbnails/The Blue Stones - Be My Fire.mp3", fire),
        file("Alternative/The Blue Stones - Be My Fire.mp3", fire),
      ],
      new Map([
        [".thumbnails/The Blue Stones - Be My Fire.mp3", 19_000],
        ["Alternative/The Blue Stones - Be My Fire.mp3", 12_500],
      ]),
    );
    assert.deepEqual(plan.moves, [
      {
        from: "Alternative/The Blue Stones - Be My Fire.mp3",
        to: "The Blue Stones/Black Holes/Be My Fire.mp3",
      },
    ]);
    assert.deepEqual(plan.duplicates, [
      {
        kept: "Alternative/The Blue Stones - Be My Fire.mp3",
        keptAs: "The Blue Stones/Black Holes/Be My Fire.mp3",
        deleted: [".thumbnails/The Blue Stones - Be My Fire.mp3"],
      },
    ]);
  });

  it("keeps the copy with the higher cutoff when both are outside .thumbnails", () => {
    const plan = movePlan(
      [file("Rock/Fire.mp3", fire), file("Alternative/Fire.mp3", fire), file("Pop/Fire.mp3", fire)],
      new Map([
        ["Rock/Fire.mp3", 16_000],
        ["Alternative/Fire.mp3", 19_500],
      ]),
    );
    assert.deepEqual(plan.duplicates, [
      {
        kept: "Alternative/Fire.mp3",
        keptAs: "The Blue Stones/Black Holes/Be My Fire.mp3",
        deleted: ["Rock/Fire.mp3", "Pop/Fire.mp3"],
      },
    ]);
    assert.deepEqual(
      plan.moves.map((move) => move.from),
      ["Alternative/Fire.mp3"],
    );
  });

  it("lists copies of one song that land on different names, and keeps them", () => {
    const fatLip = { title: "Fat Lip", artist: "Sum 41" };
    const plan = movePlan(
      [
        file("Alternative/Sum 41 - Fat Lip.mp3", { ...fatLip, album: "All The Good Sh**" }),
        file("Rock Classic/Sum 41 - Fat Lip.mp3", { ...fatLip, album: "All Killer, No Filler" }),
        file(
          "Rock/Sum 41 - Fat Lip (Live).mp3",
          { ...fatLip, album: "Live" },
          { durationMs: 260_000 },
        ),
      ],
      new Map(),
    );
    assert.equal(plan.moves.length, 3);
    assert.deepEqual(plan.duplicates, []);
    assert.deepEqual(plan.lookAlikes, [
      ["Sum 41/All The Good Sh__/Fat Lip.mp3", "Sum 41/All Killer, No Filler/Fat Lip.mp3"],
    ]);
  });

  it("leaves a song that is already in its place", () => {
    const plan = movePlan(
      [file("Band/Album/Song.mp3", { title: "Song", artist: "Band", album: "Album" })],
      new Map(),
    );
    assert.deepEqual(plan.moves, []);
    assert.deepEqual(plan.inPlace, ["Band/Album/Song.mp3"]);
  });

  it("numbers different songs that land on one name instead of deleting one", () => {
    const intro = { title: "Intro", artist: "Band", album: "Live" };
    const plan = movePlan(
      [
        file("Rock/Intro.mp3", intro, { durationMs: 60_000 }),
        file("Pop/Intro.mp3", intro, { durationMs: 200_000 }),
        file("Metal/Intro.mp3", { ...intro, artist: "Band feat. Guest" }),
        file("Trap/Intro.mp3", intro, { durationMs: 62_500 }),
      ],
      new Map(),
    );
    assert.deepEqual(plan.moves, [
      { from: "Rock/Intro.mp3", to: "Band/Live/Intro.mp3" },
      { from: "Pop/Intro.mp3", to: "Band/Live/Intro (2).mp3" },
      { from: "Metal/Intro.mp3", to: "Band/Live/Intro (3).mp3" },
    ]);
    assert.deepEqual(plan.duplicates, [
      { kept: "Rock/Intro.mp3", keptAs: "Band/Live/Intro.mp3", deleted: ["Trap/Intro.mp3"] },
    ]);
    assert.deepEqual(plan.collisions, [
      {
        name: "Band/Live/Intro.mp3",
        paths: ["Rock/Intro.mp3", "Pop/Intro.mp3", "Metal/Intro.mp3"],
      },
    ]);
  });

  it("matches names regardless of case, and spells a folder one way", () => {
    const plan = movePlan(
      [
        file("Rock/a.mp3", { title: "Numb", artist: "LINKIN PARK", album: "Meteora" }),
        file("Rock/b.mp3", { title: "Faint", artist: "Linkin Park", album: "METEORA" }),
        file("Pop/c.mp3", { title: "In the End", artist: "Linkin Park", album: "Hybrid Theory" }),
        file("Pop/d.mp3", { title: "numb", artist: "Linkin Park", album: "Meteora" }),
      ],
      new Map(),
    );
    assert.deepEqual(plan.moves, [
      { from: "Rock/a.mp3", to: "Linkin Park/Meteora/Numb.mp3" },
      { from: "Rock/b.mp3", to: "Linkin Park/Meteora/Faint.mp3" },
      { from: "Pop/c.mp3", to: "Linkin Park/Hybrid Theory/In the End.mp3" },
    ]);
    assert.deepEqual(plan.duplicates, [
      { kept: "Rock/a.mp3", keptAs: "Linkin Park/Meteora/Numb.mp3", deleted: ["Pop/d.mp3"] },
    ]);
  });
});

describe("cleanupPlan", () => {
  const entries = [
    ".stfolder/",
    ".stfolder.removed-20240911-231258/",
    ".stfolder.removed-20240911-231258/empty.txt",
    ".thumbnails/",
    ".thumbnails/.nomedia",
    ".thumbnails/1000024985.jpg",
    ".thumbnails/Copy.mp3",
    "BlackPlayer/",
    "BlackPlayer/BlackPlayer EX Track Stat Autosave.bpstat",
    "BlackPlayer (1)/",
    "BlackPlayer (1)/BlackPlayer EX Track Stat Autosave.bpstat",
    "Eletrônica/",
    "Eletrônica/Screenshot_20240918_151723_YouTube Music",
    "Eletrônica/Song.mp3",
    "Rock/",
    "Rock/Song.mp3",
    "Rock/cover.jpg",
    "YT Music/",
    "YT Music/Band/",
    "YT Music/Band/Album/",
    "YT Music/Band/Album/01 Song.mp3",
    "Band/",
    "Band/Album/",
    "Band/Album/02 Kept.mp3",
    "notes.txt",
  ];
  const moves: MovePlan = {
    moves: [
      { from: "Eletrônica/Song.mp3", to: "Band/Album/01 Song.mp3" },
      { from: "Rock/Song.mp3", to: "Band/Album/03 Rock Song.mp3" },
    ],
    duplicates: [
      {
        kept: "Eletrônica/Song.mp3",
        keptAs: "Band/Album/01 Song.mp3",
        deleted: [".thumbnails/Copy.mp3", "YT Music/Band/Album/01 Song.mp3"],
      },
    ],
    collisions: [],
    inPlace: ["Band/Album/02 Kept.mp3"],
    lookAlikes: [],
  };

  it("removes the leftovers and the folders the moves empty, but never .stfolder", () => {
    const plan = cleanupPlan(entries, moves);
    assert.deepEqual(plan.delete, [
      ".stfolder.removed-20240911-231258/",
      ".thumbnails/",
      "Eletrônica/Screenshot_20240918_151723_YouTube Music",
      "YT Music/Band/Album/",
      "YT Music/Band/",
      "Eletrônica/",
      "YT Music/",
    ]);
    assert.deepEqual(plan.blackPlayer, ["BlackPlayer/", "BlackPlayer (1)/"]);
    assert.deepEqual(plan.left, ["Rock/cover.jpg", "notes.txt"]);
  });

  it("keeps a folder whose songs leave when others move into it", () => {
    const plan = cleanupPlan(["Pop/", "Pop/Pop/", "Pop/Pop/Old.mp3", "Rock/", "Rock/New.mp3"], {
      moves: [
        { from: "Pop/Pop/Old.mp3", to: "Elsewhere/Album/Old.mp3" },
        { from: "Rock/New.mp3", to: "Pop/Pop/New.mp3" },
      ],
      duplicates: [],
      collisions: [],
      inPlace: [],
      lookAlikes: [],
    });
    assert.deepEqual(plan.delete, ["Rock/"]);
  });
});
