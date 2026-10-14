import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseBpstat, planBlackPlayerImport, summarizeBlackPlayerImport } from "./index.ts";

const MUSIC = "/storage/emulated/0/Musicas";

/** A `.bpstat` row for `<artist> - <title>.mp3`. */
interface Row {
  readonly title: string;
  readonly artist: string;
  readonly plays: number;
  readonly addedAt: number;
  readonly lastPlayedAt: number;
  readonly path?: string;
}

const pathOf = ({ title, artist }: { title: string; artist: string }): string =>
  `${MUSIC}/${artist} - ${title}.mp3`;

/** A snapshot file of [rows], as the picker reads it. */
const snapshot = (name: string, rows: readonly Row[]) => ({
  name,
  text: rows
    .map(
      (row) =>
        `${row.plays};0;${row.title};${row.artist};Album;${row.path ?? pathOf(row)};${row.addedAt};${row.lastPlayedAt}`,
    )
    .join("\n"),
});

const library = [
  { id: 1, title: "Airbag", artist: "Radiohead", durationMs: 284_000 },
  { id: 2, title: "Bloom", artist: "Radiohead", durationMs: 315_000 },
  { id: 3, title: "Creep", artist: "Radiohead", durationMs: 238_000 },
].map((track) => ({ ...track, path: pathOf(track) }));

/** Each track's planned play times. */
const datesByTrack = (plays: readonly { trackId: number; startedAt: number }[]) => {
  const dates = new Map<number, number[]>();
  for (const play of plays)
    dates.set(play.trackId, [...(dates.get(play.trackId) ?? []), play.startedAt]);
  return Object.fromEntries([...dates].map(([id, times]) => [id, times.toSorted((a, b) => a - b)]));
};

describe("planBlackPlayerImport: dating", () => {
  test("a snapshot's plays are spread evenly from when the song was added to the snapshot, never after its last play", () => {
    // The snapshot was saved at its latest last play: Bloom's, at 10,000.
    const plan = planBlackPlayerImport(
      [
        snapshot("BlackPlayer EX Track Stat Autosave.bpstat", [
          { title: "Airbag", artist: "Radiohead", plays: 4, addedAt: 0, lastPlayedAt: 4_000 },
          { title: "Bloom", artist: "Radiohead", plays: 2, addedAt: 0, lastPlayedAt: 10_000 },
        ]),
      ],
      library,
      [],
    );
    assert.deepEqual(datesByTrack(plan.plays), {
      1: [1_000, 2_000, 3_000, 4_000],
      2: [5_000, 10_000],
    });
  });

  test("snapshots go by their content, not their file names, and plays gained between two are spread over that interval", () => {
    // Saved at 4,000 (Bloom's last play), but named as if it were the later one.
    const older = snapshot("BlackPlayer EX Track Stat Autosave.bpstat (9)", [
      { title: "Airbag", artist: "Radiohead", plays: 2, addedAt: 0, lastPlayedAt: 2_000 },
      { title: "Bloom", artist: "Radiohead", plays: 1, addedAt: 0, lastPlayedAt: 4_000 },
    ]);
    // Saved at 8,000. Airbag gained two plays; Creep was added at 5,000.
    const newer = snapshot("BlackPlayer EX Track Stat Autosave.bpstat (1)", [
      { title: "Airbag", artist: "Radiohead", plays: 4, addedAt: 0, lastPlayedAt: 8_000 },
      { title: "Bloom", artist: "Radiohead", plays: 1, addedAt: 0, lastPlayedAt: 4_000 },
      { title: "Creep", artist: "Radiohead", plays: 2, addedAt: 5_000, lastPlayedAt: 7_000 },
    ]);
    const plan = planBlackPlayerImport([newer, older], library, []);
    assert.deepEqual(datesByTrack(plan.plays), {
      1: [1_000, 2_000, 6_000, 8_000],
      2: [4_000],
      3: [6_000, 7_000],
    });
  });

  test("the same snapshot picked twice counts once", () => {
    const rows = [
      { title: "Airbag", artist: "Radiohead", plays: 2, addedAt: 0, lastPlayedAt: 2_000 },
    ];
    const plan = planBlackPlayerImport(
      [snapshot("a.bpstat", rows), snapshot("a.bpstat (1)", rows)],
      library,
      [],
    );
    assert.deepEqual(datesByTrack(plan.plays), { 1: [1_000, 2_000] });
  });
});

describe("planBlackPlayerImport: importing again", () => {
  const older = snapshot("older.bpstat", [
    { title: "Airbag", artist: "Radiohead", plays: 2, addedAt: 0, lastPlayedAt: 2_000 },
    { title: "Bloom", artist: "Radiohead", plays: 1, addedAt: 0, lastPlayedAt: 4_000 },
  ]);
  const newer = snapshot("newer.bpstat", [
    { title: "Airbag", artist: "Radiohead", plays: 4, addedAt: 0, lastPlayedAt: 8_000 },
    { title: "Bloom", artist: "Radiohead", plays: 1, addedAt: 0, lastPlayedAt: 4_000 },
  ]);

  test("the same snapshots again add nothing", () => {
    const imported = [
      { trackId: 1, plays: 4, latestAt: 8_000 },
      { trackId: 2, plays: 1, latestAt: 4_000 },
    ];
    assert.deepEqual(planBlackPlayerImport([older, newer], library, imported).plays, []);
  });

  test("a newer snapshot adds only the plays gained since", () => {
    const imported = [
      { trackId: 1, plays: 2, latestAt: 2_000 },
      { trackId: 2, plays: 1, latestAt: 4_000 },
    ];
    assert.deepEqual(datesByTrack(planBlackPlayerImport([older, newer], library, imported).plays), {
      1: [6_000, 8_000],
    });
  });

  test("new plays are never dated before a song's latest imported play", () => {
    // Bloom's one play was imported at 7,000; the newer snapshot alone would
    // spread its four plays from 2,000.
    const alone = snapshot("newer.bpstat", [
      { title: "Bloom", artist: "Radiohead", plays: 4, addedAt: 0, lastPlayedAt: 8_000 },
    ]);
    const imported = [{ trackId: 2, plays: 1, latestAt: 7_000 }];
    assert.deepEqual(datesByTrack(planBlackPlayerImport([alone], library, imported).plays), {
      2: [7_333, 7_667, 8_000],
    });
  });
});

describe("summarizeBlackPlayerImport", () => {
  const rows: Row[] = [
    { title: "Airbag", artist: "Radiohead", plays: 2, addedAt: 0, lastPlayedAt: 2_000 },
    { title: "Bloom", artist: "Radiohead", plays: 1, addedAt: 0, lastPlayedAt: 4_000 },
    { title: "505", artist: "Arctic Monkeys", plays: 16, addedAt: 0, lastPlayedAt: 3_000 },
    { title: "Hash Pipe", artist: "Weezer", plays: 2, addedAt: 0, lastPlayedAt: 3_000 },
  ];

  test("says how many plays and songs were imported, and lists the songs not in the Library", () => {
    const files = [
      snapshot("a.bpstat", rows),
      { name: "notes.txt", text: "hello" },
      { name: "b.bpstat", text: null },
    ];
    assert.deepEqual(summarizeBlackPlayerImport(planBlackPlayerImport(files, library, [])), {
      title: "Imported BlackPlayer stats",
      sections: [
        { heading: "3 new plays", detail: "Of 2 songs, from 1 snapshot", missing: [] },
        {
          heading: "2 songs not in your library",
          detail: "Their 18 plays weren't imported",
          missing: ["Arctic Monkeys – 505", "Weezer – Hash Pipe"],
        },
        { heading: "notes.txt", detail: "Not a BlackPlayer stats file", missing: [] },
        { heading: "b.bpstat", detail: "Couldn't be read", missing: [] },
      ],
    });
  });

  test("importing the same files again says 0 new plays", () => {
    const files = [snapshot("a.bpstat", rows.slice(0, 2))];
    const imported = [
      { trackId: 1, plays: 2, latestAt: 2_000 },
      { trackId: 2, plays: 1, latestAt: 4_000 },
    ];
    assert.deepEqual(summarizeBlackPlayerImport(planBlackPlayerImport(files, library, imported)), {
      title: "Nothing new imported",
      sections: [
        {
          heading: "0 new plays",
          detail: "Every play in these files is in your history already",
          missing: [],
        },
      ],
    });
  });
});

/** A row with one play, unless [overrides] say otherwise. */
const row = (overrides: Partial<Row> & Pick<Row, "title" | "artist">): Row => ({
  plays: 1,
  addedAt: 0,
  lastPlayedAt: 1_000,
  ...overrides,
});

describe("planBlackPlayerImport: matching", () => {
  test("a row matches the Library song at its path, in any case", () => {
    const plan = planBlackPlayerImport(
      [
        snapshot("a.bpstat", [
          row({ title: "x", artist: "y", path: pathOf(library[0]!).toUpperCase() }),
        ]),
      ],
      library,
      [],
    );
    assert.deepEqual(
      plan.plays.map((play) => play.trackId),
      [1],
    );
    assert.deepEqual(plan.unmatched, []);
  });

  test("a row whose file has moved matches by title and artist, compared as YT Music matching compares them", () => {
    const plan = planBlackPlayerImport(
      [
        snapshot("a.bpstat", [
          row({
            title: "BLOOM (Remastered 2011)",
            artist: "radiohead",
            path: `${MUSIC}/Rock/Bloom.mp3`,
          }),
        ]),
      ],
      library,
      [],
    );
    assert.deepEqual(
      plan.plays.map((play) => play.trackId),
      [2],
    );
  });

  test("rows that match no Library song are listed by artist and title, with their plays", () => {
    const plan = planBlackPlayerImport(
      [
        snapshot("a.bpstat", [
          row({ title: "Karma Police", artist: "Radiohead", plays: 3 }),
          row({ title: "505", artist: "Arctic Monkeys", plays: 16 }),
          row({ title: "Never Played", artist: "Nobody", plays: 0 }),
        ]),
      ],
      library,
      [],
    );
    assert.deepEqual(plan.plays, []);
    assert.deepEqual(plan.unmatched, [
      { title: "505", artist: "Arctic Monkeys", plays: 16 },
      { title: "Karma Police", artist: "Radiohead", plays: 3 },
    ]);
  });
});

describe("parseBpstat", () => {
  test("one row per line: plays, title, artist, album, path, added and last played", () => {
    const text = [
      `16;0;505;Arctic Monkeys;Favourite Worst Nightmare;${MUSIC}/Alternative/Arctic Monkeys - 505.mp3;1726107791538;1780443643096`,
      `6;1;Brianstorm;Arctic Monkeys;Favourite Worst Nightmare;${MUSIC}/Alternative/Arctic Monkeys - Brianstorm.mp3;1726107644839;1784073251678`,
      "",
    ].join("\n");
    assert.deepEqual(parseBpstat(text), [
      {
        plays: 16,
        title: "505",
        artist: "Arctic Monkeys",
        album: "Favourite Worst Nightmare",
        path: `${MUSIC}/Alternative/Arctic Monkeys - 505.mp3`,
        addedAt: 1726107791538,
        lastPlayedAt: 1780443643096,
      },
      {
        plays: 6,
        title: "Brianstorm",
        artist: "Arctic Monkeys",
        album: "Favourite Worst Nightmare",
        path: `${MUSIC}/Alternative/Arctic Monkeys - Brianstorm.mp3`,
        addedAt: 1726107644839,
        lastPlayedAt: 1784073251678,
      },
    ]);
  });

  test("a ';' inside a title, an album or a path stays in that field", () => {
    const text = [
      `2;0;무대로 Déjà Vu; 舞代路;NCT DREAM;NCT RESONANCE Pt.1 - The 2nd Album;${MUSIC}/Kpop/NCT DREAM - 무대로 Deja Vu; 舞代路.mp3;1726107610666;1743264177663`,
      `3;0;Hush Hush; Hush Hush / I Will Survive (Medley);The Pussycat Dolls;Hush Hush; Hush Hush;${MUSIC}/Nostalgic/The Pussycat Dolls - Hush Hush; Hush Hush _ I Will Survive (Medley).mp3;1726107795070;1755739508874`,
    ].join("\r\n");
    assert.deepEqual(
      parseBpstat(text).map(({ title, artist, album, path }) => ({ title, artist, album, path })),
      [
        {
          title: "무대로 Déjà Vu; 舞代路",
          artist: "NCT DREAM",
          album: "NCT RESONANCE Pt.1 - The 2nd Album",
          path: `${MUSIC}/Kpop/NCT DREAM - 무대로 Deja Vu; 舞代路.mp3`,
        },
        {
          title: "Hush Hush; Hush Hush / I Will Survive (Medley)",
          artist: "The Pussycat Dolls",
          album: "Hush Hush; Hush Hush",
          path: `${MUSIC}/Nostalgic/The Pussycat Dolls - Hush Hush; Hush Hush _ I Will Survive (Medley).mp3`,
        },
      ],
    );
  });

  test("lines that aren't track stats are skipped", () => {
    const text = [
      "﻿<settings version=3>",
      "x;0;Title;Artist;Album;/a.mp3;1;2",
      "4;0;Title;Artist;Album;/a.mp3;1",
      `4;0;Airbag;Radiohead;OK Computer;${MUSIC}/Airbag.mp3;1000;2000`,
    ].join("\n");
    assert.deepEqual(
      parseBpstat(text).map((row) => row.title),
      ["Airbag"],
    );
  });
});
