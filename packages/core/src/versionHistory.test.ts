import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  keptVersionHistory,
  readKeptVersionHistory,
  readVersionHistory,
  versionHistoryEntries,
  versionHistorySummary,
  versionHistoryUrl,
  type DatedRelease,
} from "./index.ts";

const sections = (word: string) => ({ new: [`${word} new`], fixes: [`${word} fix`] });

const dated = (
  version: string,
  date: string | null = "2026-11-04T12:00:00.000Z",
  notes: DatedRelease["notes"] = { en: sections(version), "pt-BR": sections(version) },
): DatedRelease => ({ version, date: date === null ? null : Date.parse(date), notes });

const versions = (entries: readonly { readonly version: string }[]) =>
  entries.map(({ version }) => version);

describe("readVersionHistory", () => {
  it("reads each release's date, version and notes from the service's answer", () => {
    assert.deepEqual(
      readVersionHistory({
        releases: [
          {
            version: "0.48.0-ti",
            date: "2026-11-04T12:00:00.000Z",
            notes: { en: sections("A"), "pt-BR": sections("B") },
          },
        ],
      }),
      [
        {
          version: "0.48.0-ti",
          date: Date.parse("2026-11-04T12:00:00.000Z"),
          notes: { en: sections("A"), "pt-BR": sections("B") },
        },
      ],
    );
  });

  it("gives a release without Portuguese its English lines, and one without a date none", () => {
    assert.deepEqual(
      readVersionHistory({ releases: [{ version: "0.47.0-ti", notes: { en: sections("A") } }] }),
      [{ version: "0.47.0-ti", date: null, notes: { en: sections("A"), "pt-BR": sections("A") } }],
    );
    assert.deepEqual(
      readVersionHistory({
        releases: [{ version: "0.47.0-ti", date: "soon", notes: { en: sections("A") } }],
      })?.[0]?.date,
      null,
    );
  });

  it("refuses an answer it can't read", () => {
    for (const answer of [null, "x", {}, { releases: "x" }]) {
      assert.equal(readVersionHistory(answer), null);
    }
  });

  it("leaves out a release it can't read and keeps the others", () => {
    const readable = (version: string) => ({
      version,
      date: "2026-11-04T12:00:00.000Z",
      notes: { en: sections(version) },
    });
    assert.deepEqual(
      versions(
        readVersionHistory({
          releases: [
            readable("0.49.0-ti"),
            { version: 1, notes: { en: sections("A") } },
            { version: "0.48.1-ti" },
            "x",
            null,
            readable("0.48.0-ti"),
          ],
        }) ?? [],
      ),
      ["0.49.0-ti", "0.48.0-ti"],
    );
  });
});

describe("keptVersionHistory", () => {
  it("keeps a list on the phone that reads back as it was, dates and all", () => {
    const releases = [
      dated("0.49.0-ti", "2026-11-05T09:30:00.000Z", {
        en: sections("A"),
        "pt-BR": sections("B"),
      }),
      dated("0.48.0-ti", null),
    ];
    assert.deepEqual(readKeptVersionHistory(keptVersionHistory(releases)), releases);
    assert.deepEqual(readKeptVersionHistory(keptVersionHistory([])), []);
  });

  it("has nothing kept when nothing is stored or what is stored can't be read", () => {
    for (const stored of [null, "", "not json", "{}", '{"releases":"x"}']) {
      assert.equal(readKeptVersionHistory(stored), null);
    }
  });
});

describe("versionHistoryUrl", () => {
  it("asks the service the manifest comes from for the channel's whole history", () => {
    assert.equal(
      versionHistoryUrl({ manifestUrl: "https://updates.example/v1/manifest", channel: "ti" }),
      "https://updates.example/v1/notes?channel=ti",
    );
  });

  it("has no address in a build with updates off or no manifest address", () => {
    const manifestUrl = "https://updates.example/v1/manifest";
    assert.equal(versionHistoryUrl({ manifestUrl, channel: "none" }), null);
    assert.equal(versionHistoryUrl({ manifestUrl, channel: null }), null);
    assert.equal(versionHistoryUrl({ manifestUrl: undefined, channel: "main" }), null);
    assert.equal(versionHistoryUrl({ manifestUrl: "https://x/y", channel: "main" }), null);
  });
});

describe("versionHistoryEntries", () => {
  it("lists the releases newest first, by version number", () => {
    const releases = ["0.9.0-ti", "0.47.0-ti", "0.10.0-ti", "0.47.1-ti"].map((v) => dated(v));
    assert.deepEqual(
      versions(
        versionHistoryEntries({ releases, runningVersion: null, channel: "ti", language: "en" }),
      ),
      ["0.47.1-ti", "0.47.0-ti", "0.10.0-ti", "0.9.0-ti"],
    );
  });

  it("keeps a ti phone to -ti releases and a main phone to stable ones", () => {
    const releases = ["0.48.0-ti", "0.48.0", "0.47.0-ti", "0.47.0"].map((v) => dated(v));
    const on = (channel: string) =>
      versions(versionHistoryEntries({ releases, runningVersion: null, channel, language: "en" }));
    assert.deepEqual(on("ti"), ["0.48.0-ti", "0.47.0-ti"]);
    assert.deepEqual(on("main"), ["0.48.0", "0.47.0"]);
  });

  it("marks the running version Current, with newer releases above it", () => {
    const releases = ["0.47.0-ti", "0.49.0-ti", "0.48.0-ti"].map((v) => dated(v));
    const entries = versionHistoryEntries({
      releases,
      runningVersion: "0.48.0-ti",
      channel: "ti",
      language: "en",
    });
    assert.deepEqual(
      entries.map(({ version, current }) => ({ version, current })),
      [
        { version: "0.49.0-ti", current: false },
        { version: "0.48.0-ti", current: true },
        { version: "0.47.0-ti", current: false },
      ],
    );
  });

  it("marks none Current when the running version has no notes, or can't be told", () => {
    const releases = ["0.47.0-ti", "0.49.0-ti"].map((v) => dated(v));
    for (const runningVersion of ["0.48.0-ti", null]) {
      const entries = versionHistoryEntries({
        releases,
        runningVersion,
        channel: "ti",
        language: "en",
      });
      assert.deepEqual(
        entries.map(({ current }) => current),
        [false, false],
      );
    }
  });

  it("says each release's date and lines in Wave's language, leaving out an empty section", () => {
    const releases = [
      dated("0.48.0-ti", "2026-11-04T12:00:00.000Z", {
        en: { new: ["Artist pages"], fixes: [] },
        "pt-BR": { new: ["Páginas de artista"], fixes: [] },
      }),
    ];
    const asked = { releases, runningVersion: null, channel: "ti" };
    const [en] = versionHistoryEntries({ ...asked, language: "en" });
    assert.equal(en?.date, "November 4, 2026");
    assert.deepEqual(en?.sections, [{ title: "New", lines: ["Artist pages"] }]);
    const [ptBr] = versionHistoryEntries({ ...asked, language: "pt-BR" });
    assert.equal(ptBr?.date, "4 de novembro de 2026");
    assert.deepEqual(ptBr?.sections, [{ title: "Novo", lines: ["Páginas de artista"] }]);
  });

  it("gives a release with no date none, and keeps both sections when both have lines", () => {
    const [entry] = versionHistoryEntries({
      releases: [dated("0.48.0-ti", null)],
      runningVersion: null,
      channel: "ti",
      language: "en",
    });
    assert.equal(entry?.date, null);
    assert.deepEqual(entry?.sections, [
      { title: "New", lines: ["0.48.0-ti new"] },
      { title: "Fixes", lines: ["0.48.0-ti fix"] },
    ]);
  });
});

describe("versionHistorySummary", () => {
  const releases = [
    dated("0.49.0-ti", "2026-11-05T12:00:00.000Z"),
    dated("0.48.0-ti", "2026-11-04T12:00:00.000Z"),
  ];

  it("is the running version's date, in Wave's language", () => {
    const asked = { releases, runningVersion: "0.48.0-ti", channel: "ti" };
    assert.equal(versionHistorySummary({ ...asked, language: "en" }), "November 4, 2026");
    assert.equal(versionHistorySummary({ ...asked, language: "pt-BR" }), "4 de novembro de 2026");
  });

  it("is nothing when the running version has no notes or no date, or the history isn't read", () => {
    const asked = { channel: "ti", language: "en" } as const;
    assert.equal(versionHistorySummary({ ...asked, releases, runningVersion: "0.47.0-ti" }), null);
    assert.equal(versionHistorySummary({ ...asked, releases, runningVersion: null }), null);
    const undated = [dated("0.48.0-ti", null)];
    assert.equal(
      versionHistorySummary({ ...asked, releases: undated, runningVersion: "0.48.0-ti" }),
      null,
    );
    assert.equal(
      versionHistorySummary({ ...asked, releases: null, runningVersion: "0.48.0-ti" }),
      null,
    );
  });
});
