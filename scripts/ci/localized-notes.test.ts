import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { localizedNotes, needsPortugueseNote, portugueseNote } from "./localized-notes.ts";
import type { MergedPr } from "./patch-notes.ts";

const pr = (number: number, fields: Partial<MergedPr> = {}): MergedPr => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/LeoPerez8/wave/pull/${number}`,
  branch: `feat/${number}-thing`,
  base: "ti",
  body: "",
  mergeCommit: `commit-${number}`,
  files: ["apps/mobile/src/app/_layout.tsx"],
  issues: [],
  ...fields,
});

describe("portugueseNote", () => {
  it("reads the line wherever it sits in the body", () => {
    assert.equal(
      portugueseNote("Closes #12\n\npt-BR: Letras aparecem de novo\n\nDetails"),
      "Letras aparecem de novo",
    );
  });

  it("reads a body GitHub's editor saved with CRLF line ends", () => {
    assert.equal(portugueseNote("Closes #12\r\npt-BR: Fila corrigida  \r\nMore"), "Fila corrigida");
  });

  for (const [what, body] of [
    ["no line", "Closes #12"],
    ["an empty line, leaving the next line alone", "pt-BR:   \nDetails"],
    ["a mention inside a sentence", "This adds the pt-BR: line to the notes"],
    ["another language", "pt-PT: Olá"],
  ] as const) {
    it(`finds nothing for ${what}`, () => {
      assert.equal(portugueseNote(body), null);
    });
  }
});

describe("localizedNotes", () => {
  it("gives each listed PR's English title and Portuguese line, in New and Fixes", () => {
    assert.deepEqual(
      localizedNotes({
        commits: ["commit-1", "commit-2"],
        bugIssues: [],
        pullRequests: [
          pr(1, { title: "Artist pages", body: "pt-BR: Páginas de artista" }),
          pr(2, { title: "Lyrics show again", branch: "fix/2-lyrics", body: "pt-BR: Letras" }),
        ],
      }),
      {
        en: { new: ["Artist pages"], fixes: ["Lyrics show again"] },
        "pt-BR": { new: ["Páginas de artista"], fixes: ["Letras"] },
      },
    );
  });

  it("falls back to the English title for a PR with no line", () => {
    const notes = localizedNotes({
      commits: ["commit-1"],
      bugIssues: [],
      pullRequests: [pr(1, { title: "Artist pages" })],
    });
    assert.deepEqual(notes["pt-BR"], { new: ["Artist pages"], fixes: [] });
  });

  it("lists the same PRs as the patch notes", () => {
    const notes = localizedNotes({
      commits: ["commit-1", "commit-3"],
      bugIssues: [],
      pullRequests: [
        pr(1, { title: "Listed" }),
        pr(2, { title: "Not in this release" }),
        pr(3, { title: "CI only", files: [".github/workflows/ci.yml"] }),
      ],
    });
    assert.deepEqual(notes.en, { new: ["Listed"], fixes: [] });
    assert.deepEqual(notes["pt-BR"], { new: ["Listed"], fixes: [] });
  });
});

describe("needsPortugueseNote", () => {
  const app = ["apps/mobile/src/app/_layout.tsx"];

  it("wants the line from a PR the notes will list", () => {
    assert.equal(needsPortugueseNote({ body: "Closes #1", files: app }), true);
  });

  it("is satisfied once the line is there", () => {
    assert.equal(needsPortugueseNote({ body: "pt-BR: Olá", files: app }), false);
  });

  it("doesn't want it from a PR the notes won't list", () => {
    for (const files of [[".github/workflows/ci.yml"], ["docs/spec.md"], ["scripts/ci/report.sh"]])
      assert.equal(needsPortugueseNote({ body: "", files }), false);
  });

  it("wants it when GitHub couldn't list every file, as the notes list that PR", () => {
    assert.equal(needsPortugueseNote({ body: "", files: null }), true);
  });
});

describe("the CLI", () => {
  const script = fileURLToPath(new URL("./localized-notes.ts", import.meta.url));

  it("prints one line of JSON, from what patch-notes.sh gathers", () => {
    const dir = mkdtempSync(join(tmpdir(), "localized-notes-"));
    writeFileSync(join(dir, "commits.txt"), "commit-90\ncommit-91\n");
    writeFileSync(join(dir, "bugs.txt"), "5\n");
    const prs = [pr(90, { issues: [5], body: "pt-BR: Conserto" }), pr(91)]
      .map((it) => JSON.stringify(it))
      .join("\n");
    const output = execFileSync(
      process.execPath,
      [script, join(dir, "commits.txt"), join(dir, "bugs.txt")],
      { input: `${prs}\n`, encoding: "utf8" },
    );
    assert.equal(output.trim().includes("\n"), false);
    assert.deepEqual(JSON.parse(output), {
      en: { new: ["PR 91"], fixes: ["PR 90"] },
      "pt-BR": { new: ["PR 91"], fixes: ["Conserto"] },
    });
  });

  it("answers whether a PR needs the line, from its body on stdin and its files", () => {
    const dir = mkdtempSync(join(tmpdir(), "localized-notes-"));
    const files = join(dir, "files.txt");
    const ask = (paths: string, body: string) => {
      writeFileSync(files, paths);
      return execFileSync(process.execPath, [script, "--needs-note", files], {
        input: body,
        encoding: "utf8",
      }).trim();
    };
    assert.equal(ask("apps/mobile/app.config.ts\n", "Closes #1"), "yes");
    assert.equal(ask("apps/mobile/app.config.ts\n", "pt-BR: Olá"), "no");
    assert.equal(ask("docs/spec.md\n", "Closes #1"), "no");
  });
});
