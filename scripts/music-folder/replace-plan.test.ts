import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FolderFile } from "./plan.ts";
import type { SoulseekCandidate } from "../../packages/core/src/index.ts";
import {
  findOnDisk,
  folderSplitter,
  judgeDownload,
  nextPeers,
  parseOrganizeLog,
  parseReplaceList,
  parseReplaceLog,
  recordingOf,
  reportText,
  toDo,
  type Probe,
  type ReportRow,
} from "./replace-plan.ts";

const report = (filename: string, more: Partial<SoulseekCandidate> = {}): SoulseekCandidate => ({
  username: "peer",
  filename,
  bytes: 8_000_000,
  bitrateKbps: 320,
  durationMs: 200_000,
  freeSlot: true,
  uploadSpeed: 1000,
  queueLength: 0,
  ...more,
});

const file = (path: string, tags: FolderFile["tags"] = {}): FolderFile => ({
  path,
  sizeBytes: 1000,
  durationMs: 200_000,
  tags,
});

describe("findOnDisk", () => {
  it("finds an entry at its old path before the folder is organized", () => {
    const entries = parseReplaceList("Alternative\tArctic Monkeys - Arabella\r\n");
    const found = findOnDisk(entries, [file("Alternative/Arctic Monkeys - Arabella.mp3")], []);
    assert.deepEqual(found, [
      {
        entry: entries[0],
        found: true,
        path: "Alternative/Arctic Monkeys - Arabella.mp3",
        via: "old path",
      },
    ]);
  });

  it("follows the organize log's move, ignoring case and failed moves", () => {
    const entries = parseReplaceList("Eletrônica\tAlok - Hear Me Now\n");
    const log = parseOrganizeLog(
      [
        '{"at":"1","phase":"genre","path":"Eletrônica/Alok - Hear Me Now.mp3","genre":"Eletrônica"}',
        '{"at":"2","phase":"move","from":"ELETRÔNICA/alok - hear me now.mp3","to":"Wrong/Place.mp3","error":"the new path is taken"}',
        '{"at":"3","phase":"move","from":"Eletrônica/Alok - Hear Me Now.mp3","to":"Alok/Hear Me Now/01 Hear Me Now.mp3"}',
        "",
      ].join("\n"),
    );
    const found = findOnDisk(entries, [file("Alok/Hear Me Now/01 Hear Me Now.mp3")], log);
    assert.deepEqual(found, [
      {
        entry: entries[0],
        found: true,
        path: "Alok/Hear Me Now/01 Hear Me Now.mp3",
        via: "organize log",
      },
    ]);
  });

  it("follows a deleted duplicate to the copy that was kept", () => {
    const entries = parseReplaceList("Alternative\tSum 41 - In Too Deep\n");
    const log = parseOrganizeLog(
      [
        '{"phase":"move","from":"Rock Classic/Sum 41 - In Too Deep.mp3","to":"Sum 41/All Killer, No Filler/05 In Too Deep.mp3"}',
        '{"phase":"delete-duplicate","path":"Alternative/Sum 41 - In Too Deep.mp3","keptAs":"Sum 41/All Killer, No Filler/05 In Too Deep.mp3"}',
      ].join("\n"),
    );
    const found = findOnDisk(
      entries,
      [file("Sum 41/All Killer, No Filler/05 In Too Deep.mp3")],
      log,
    );
    assert.equal(
      found[0]?.found && found[0].path,
      "Sum 41/All Killer, No Filler/05 In Too Deep.mp3",
    );
  });

  it("says so when the log's new path is gone", () => {
    const entries = parseReplaceList("Rock\tA - B\n");
    const log = parseOrganizeLog('{"phase":"move","from":"Rock/A - B.mp3","to":"A/Album/B.mp3"}');
    const [found] = findOnDisk(entries, [], log);
    assert.deepEqual(found, {
      entry: entries[0],
      found: false,
      reason: "the organize log moved it to A/Album/B.mp3, which is gone",
    });
  });

  it("finds an organized song by its tags when there is no log", () => {
    const entries = parseReplaceList(
      "Rock BR\tLegião Urbana - Tempo Perdido\nPop\tAlok, Bhaskar - Fuego\n",
    );
    const found = findOnDisk(
      entries,
      [
        file("Legiao Urbana/Dois/05 Tempo Perdido.mp3", {
          artist: "Legiao Urbana",
          title: "Tempo perdido",
        }),
        file("Alok, Bhaskar/Fuego/01 Fuego.mp3", { artists: ["Alok", "Bhaskar"], title: "Fuego" }),
        file("Other/Song.mp3", { artist: "Legião Urbana", title: "Tempo" }),
      ],
      [],
    );
    assert.deepEqual(
      found.map((where) => (where.found ? [where.path, where.via] : where.reason)),
      [
        ["Legiao Urbana/Dois/05 Tempo Perdido.mp3", "tags"],
        ["Alok, Bhaskar/Fuego/01 Fuego.mp3", "tags"],
      ],
    );
  });

  it("finds a song whose old name had extra words, the title first, or fewer notes than its tags", () => {
    const entries = parseReplaceList(
      [
        "Alternative\tParamore - Decode (Bonus Track) (HQ Audio)",
        "Brasileiras\t2026 - LAGUM",
        "Brasileiras\tCazuza - O Tempo Não Pára",
        "Pop\tWiz Khalifa - See You Again ft. Charlie Puth [Official Video] Furious 7 Soundtrack",
        "Rock\tFoo - Bar",
        "",
      ].join("\n"),
    );
    const found = findOnDisk(
      entries,
      [
        file("Paramore/Riot!/Decode.mp3", { artists: ["Paramore"], title: "Decode" }),
        file("Lagum/Coisas/2026.mp3", { artists: ["Lagum"], title: "2026" }),
        file("Cazuza/Ao Vivo/O Tempo Nao Para (Ao Vivo).mp3", {
          artists: ["Cazuza"],
          title: "O Tempo Não Pára (Ao Vivo)",
        }),
        file("Wiz Khalifa, Charlie Puth/Furious 7/See You Again.mp3", {
          artists: ["Wiz Khalifa, Charlie Puth"],
          title: "See You Again",
        }),
        file("Foo/Baz.mp3", { artists: ["Foo"], title: "Baz" }),
        file("Bar/Foo.mp3", { artists: ["Bar Fighters"], title: "Foo" }),
      ],
      [],
    );
    assert.deepEqual(
      found.map((where) => (where.found ? where.path : where.reason)),
      [
        "Paramore/Riot!/Decode.mp3",
        "Lagum/Coisas/2026.mp3",
        "Cazuza/Ao Vivo/O Tempo Nao Para (Ao Vivo).mp3",
        "Wiz Khalifa, Charlie Puth/Furious 7/See You Again.mp3",
        "no file has its old path or its artist and title",
      ],
    );
  });

  it("prefers the copy outside .thumbnails and won't guess between two others", () => {
    const tags = { artist: "The Blue Stones", title: "Don't Miss" };
    const entries = parseReplaceList(
      "Alternative\tThe Blue Stones - Don't Miss\nRock\tSum 41 - Fat Lip\n",
    );
    const found = findOnDisk(
      entries,
      [
        file(".thumbnails/The Blue Stones - Don't Miss.mp3", tags),
        file("The Blue Stones/Pretty Monster/03 Don't Miss.mp3", tags),
        file("Sum 41/A/01 Fat Lip.mp3", { artist: "Sum 41", title: "Fat Lip" }),
        file("Sum 41/B/02 Fat Lip.mp3", { artist: "Sum 41", title: "Fat Lip" }),
      ],
      [],
    );
    assert.deepEqual(
      found.map((where) => (where.found ? where.path : where.reason)),
      [
        "The Blue Stones/Pretty Monster/03 Don't Miss.mp3",
        "2 files have its artist and title: Sum 41/A/01 Fat Lip.mp3 | Sum 41/B/02 Fat Lip.mp3",
      ],
    );
  });
});

describe("recordingOf and nextPeers", () => {
  const arabella = file("Alternative/Arctic Monkeys - Arabella.mp3", {
    artist: "Arctic Monkeys",
    title: "Arabella",
    album: "AM",
  });
  const entry = parseReplaceList("Alternative\tArctic Monkeys - Arabella\n")[0]!;

  it("searches for the file's main artist and title", () => {
    const song = recordingOf({ ...arabella, durationMs: 207_300 }, entry);
    assert.equal(song.query, "Arctic Monkeys Arabella");
    assert.deepEqual(song.song.artists, ["Arctic Monkeys"]);
    assert.equal(song.song.durationMs, 207_300);
  });

  it("splits a credit the way the folder's credits do", () => {
    const acdc = file("Rock/AC/DC - Thunderstruck.mp3", {
      artist: "AC/DC",
      title: "Thunderstruck",
    });
    const alok = file("Pop/Alok, Bhaskar - Fuego.mp3", { artist: "Alok, Bhaskar", title: "Fuego" });
    const solo = file("Pop/Alok - Hear Me Now.mp3", { artist: "Alok", title: "Hear Me Now" });
    const split = folderSplitter([acdc, alok, solo]);
    assert.deepEqual(recordingOf(acdc, entry, split).song.artists, ["AC/DC"]);
    assert.deepEqual(recordingOf(alok, entry, split).song.artists, ["Alok", "Bhaskar"]);
    assert.equal(recordingOf(alok, entry, split).query, "Alok Fuego");
  });

  it("falls back to the list's Artist - Title when the file has no tags", () => {
    const song = recordingOf(file("Alternative/Arctic Monkeys - Arabella.mp3"), entry);
    assert.equal(song.query, "Arctic Monkeys Arabella");
  });

  it("offers only the same recording at 320 kbps within 3 seconds, and the next ones once tried", () => {
    const { song } = recordingOf(arabella, entry);
    const reports = [
      report("Music\\Arctic Monkeys\\AM\\01 Arabella.mp3", { username: "a" }),
      report("Music\\Arctic Monkeys - Arabella (Live).mp3", { username: "live" }),
      report("Arctic Monkeys - Arabella (Remix).mp3", { username: "remix" }),
      report("Arctic Monkeys - Arabella.mp3", { username: "slow", durationMs: 203_500 }),
      report("Arctic Monkeys - Arabella.mp3", { username: "vbr", bitrateKbps: 256 }),
      report("Arctic Monkeys - Arabella.mp3", { username: "b" }),
      report("Arctic Monkeys - Arabella.mp3", { username: "c" }),
      report("Arctic Monkeys - Arabella.mp3", { username: "d", queueLength: 5 }),
    ];
    const first = nextPeers(song, reports, []);
    assert.deepEqual(
      first.map((peer) => peer.username),
      ["a", "b", "c"],
    );
    const second = nextPeers(song, reports, first);
    assert.deepEqual(
      second.map((peer) => peer.username),
      ["d"],
    );
    assert.deepEqual(nextPeers(song, reports, [...first, ...second]), []);
  });
});

/** A downloaded file of Arabella, measured, as good as it gets unless [more] says otherwise. */
const probe = (more: Partial<Probe> = {}): Probe => ({
  path: "part.mp3",
  sizeBytes: 8_000_000,
  sha256: "x",
  durationMs: 201_500,
  bitrateKbps: 320,
  mp3: { ok: true, durationMs: 201_500, sampleRate: 44_100, frames: 7_714 },
  cutoffHz: 20_000,
  tags: { title: "Arabella", artist: "Arctic Monkeys", album: "AM" },
  ...more,
});

describe("judgeDownload", () => {
  const { song } = recordingOf(
    file("Alternative/Arctic Monkeys - Arabella.mp3", {
      artist: "Arctic Monkeys",
      title: "Arabella",
      album: "AM",
    }),
    parseReplaceList("Alternative\tArctic Monkeys - Arabella\n")[0]!,
  );

  it("accepts the same recording at 320 kbps throughout whose spectrum reaches 19.5 kHz", () => {
    assert.deepEqual(judgeDownload(song, probe()), { accepted: true, cutoffHz: 20_000 });
    assert.deepEqual(judgeDownload(song, probe({ cutoffHz: 19_500 })), {
      accepted: true,
      cutoffHz: 19_500,
    });
  });

  it("accepts a spectrum with no cliff, which the quality report counts as full band", () => {
    assert.deepEqual(judgeDownload(song, probe({ cutoffHz: null })), {
      accepted: true,
      cutoffHz: null,
    });
  });

  it("rejects a 320 kbps upscale of a lossy file", () => {
    assert.deepEqual(judgeDownload(song, probe({ cutoffHz: 16_250 })), {
      accepted: false,
      reason: "upscaled: its spectrum stops at 16.25 kHz",
    });
    assert.deepEqual(judgeDownload(song, probe({ cutoffHz: 19_250 })), {
      accepted: false,
      reason: "upscaled: its spectrum stops at 19.25 kHz",
    });
  });

  it("rejects a file that isn't MPEG-1 Layer III at 320 kbps throughout", () => {
    assert.deepEqual(
      judgeDownload(song, probe({ mp3: { ok: false, error: "frame 812 is 256 kbps" } })),
      { accepted: false, reason: "frame 812 is 256 kbps" },
    );
  });

  it("rejects a duration more than 3 seconds away from the old file's", () => {
    const longer = probe({ mp3: { ok: true, durationMs: 203_100, sampleRate: 44_100, frames: 1 } });
    assert.deepEqual(judgeDownload(song, longer), {
      accepted: false,
      reason: "it lasts 3:23, the old file 3:20",
    });
    const close = probe({ mp3: { ok: true, durationMs: 197_000, sampleRate: 44_100, frames: 1 } });
    assert.equal(judgeDownload(song, close).accepted, true);
  });

  it("rejects a file whose own tags name another recording", () => {
    assert.deepEqual(
      judgeDownload(
        song,
        probe({
          tags: { title: "Arabella (Live at Glastonbury)", artist: "Arctic Monkeys", album: null },
        }),
      ),
      {
        accepted: false,
        reason: "its tags name another recording: Arctic Monkeys - Arabella (Live at Glastonbury)",
      },
    );
    assert.equal(
      judgeDownload(song, probe({ tags: { title: null, artist: null, album: null } })).accepted,
      true,
    );
  });

  it("rejects a file whose spectrum couldn't be measured", () => {
    assert.deepEqual(judgeDownload(song, probe({ cutoffHz: null, cutoffError: "too short" })), {
      accepted: false,
      reason: "its spectrum couldn't be measured: too short",
    });
  });
});

describe("reportText", () => {
  const [a, b, c, d, e, f] = parseReplaceList(
    [
      "Rock\tA - One",
      "Rock\tB - Two",
      "Pop\tC - Three",
      "Pop\tD - Four",
      "Pop\tE - Five",
      "Funk\tF - Six",
    ].join("\n"),
  );
  const rows: ReportRow[] = [
    {
      entry: a!,
      state: "done",
      record: {
        at: "t",
        entry: a!.line,
        outcome: "replaced",
        path: "A/Album/01 One.mp3",
        cutoffHz: 20_000,
        peer: { username: "peer1", filename: "Music\\A\\Album\\01 One.mp3" },
        tried: [
          {
            username: "peer0",
            filename: "One.mp3",
            reason: "upscaled: its spectrum stops at 16 kHz",
          },
        ],
        sizeBefore: 5_000_000,
        sizeAfter: 9_000_000,
        sha256: "x",
      },
    },
    {
      entry: b!,
      state: "done",
      record: {
        at: "t",
        entry: b!.line,
        outcome: "rejected",
        path: "Rock/B - Two.mp3",
        query: "B Two",
        tried: [
          {
            username: "p",
            filename: "B - Two.mp3",
            reason: "upscaled: its spectrum stops at 16.5 kHz",
          },
          { username: "q", filename: "B - Two.mp3", reason: "the peer is unavailable" },
        ],
      },
    },
    {
      entry: c!,
      state: "done",
      record: {
        at: "t",
        entry: c!.line,
        outcome: "no-candidates",
        path: "Pop/C - Three.mp3",
        query: "C Three",
        reports: 12,
      },
    },
    { entry: d!, state: "not-found", reason: "no file has its old path or its artist and title" },
    {
      entry: e!,
      state: "to-do",
      path: "Pop/E - Five.mp3",
      query: "E Five",
      now: "16.5 kHz, 320 kbps",
    },
    {
      entry: f!,
      state: "done",
      record: {
        at: "t",
        entry: f!.line,
        outcome: "already-good",
        path: "Funk/F - Six.mp3",
        cutoffHz: 20_250,
      },
    },
  ];
  const text = reportText(rows, {
    folder: "C:\\Music",
    made: "2026-10-14T00:00:00.000Z",
    dryRun: false,
  });
  const lines = text.split("\n");

  it("counts every entry once in the summary", () => {
    for (const line of [
      "  List entries:                  6",
      "  Found on disk:                 5",
      "  Not found on disk:             1",
      "  Replaced:                      1",
      "  Already good (not replaced):   1",
      "  Rejected:                      1",
      "  Nobody on Soulseek had it:     1",
      "  Failed (tried again next run): 0",
      "  Still to do:                   1",
    ])
      assert.ok(lines.includes(line), `missing: ${line}\n${text}`);
  });

  it("lists replaced songs with their new cutoff, and the others with why", () => {
    for (const line of [
      "  Rock\tA - One -> A/Album/01 One.mp3 [20 kHz, from peer1: Music\\A\\Album\\01 One.mp3]",
      '  Rock\tB - Two (Rock/B - Two.mp3; searched "B Two")',
      "      p: B - Two.mp3: upscaled: its spectrum stops at 16.5 kHz",
      "      q: B - Two.mp3: the peer is unavailable",
      '  Pop\tC - Three (Pop/C - Three.mp3): no 320 kbps copy of this recording among 12 results for "C Three"',
      "  Pop\tD - Four: no file has its old path or its artist and title",
      '  Pop\tE - Five -> Pop/E - Five.mp3 [now 16.5 kHz, 320 kbps; search "E Five"]',
      "  Funk\tF - Six -> Funk/F - Six.mp3 [20.25 kHz]",
    ])
      assert.ok(lines.includes(line), `missing: ${line}\n${text}`);
  });

  it("says when it was a dry run", () => {
    const dry = reportText([], { folder: "C:\\Music", made: "t", dryRun: true });
    assert.match(dry, /Dry run: nothing was downloaded or changed\./);
  });
});

describe("toDo", () => {
  const entries = parseReplaceList(
    [
      "Rock\tA - Replaced",
      "Rock\tB - Rejected",
      "Rock\tC - Nobody",
      "Rock\tD - Failed",
      "Rock\tE - New",
      "",
    ].join("\n"),
  );
  const log = parseReplaceLog(
    [
      '{"at":"1","entry":"Rock\\tA - Replaced","outcome":"replaced","path":"Rock/A - Replaced.mp3","cutoffHz":20000}',
      '{"at":"2","entry":"Rock\\tB - Rejected","outcome":"rejected","path":"Rock/B - Rejected.mp3","tried":[]}',
      '{"at":"3","entry":"Rock\\tC - Nobody","outcome":"no-candidates","path":"Rock/C - Nobody.mp3","query":"C Nobody"}',
      '{"at":"4","entry":"Rock\\tD - Failed","outcome":"failed","path":"Rock/D - Failed.mp3","error":"offline"}',
      '{"at":"5","entry":"Rock\\tA - Replaced","outcome":"failed","path":"Rock/A - Replaced.mp3","error":"x"}',
      '{"broken',
    ].join("\n"),
  );

  it("skips songs already replaced or settled, and tries the rest", () => {
    assert.deepEqual(
      entries.map((entry) => toDo(entry, log, { retry: false })),
      ["replaced", "rejected", "no-candidates", "try", "try"],
    );
  });

  it("tries rejected songs again with --retry, but never a replaced one", () => {
    assert.deepEqual(
      entries.map((entry) => toDo(entry, log, { retry: true })),
      ["replaced", "try", "try", "try", "try"],
    );
  });
});
