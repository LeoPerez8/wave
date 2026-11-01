// A release's notes in each language, for the update service: the PRs its patch notes list, by
// their English title and the `pt-BR: …` line of their body, or the title with no such line.
// patch-notes.sh prints them as one line of JSON, from the same input as patch-notes.ts:
//   <prs> | node scripts/ci/localized-notes.ts <commits file> <bug issues file>
// pt-br-note.sh asks whether an open PR should have the line, from its body and files:
//   <body> | node scripts/ci/localized-notes.ts --needs-note <files file>
// Prints "yes" or "no".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type MergedPr,
  type PatchNotesInput,
  isListed,
  notesSections,
  parseMergedPr,
} from "./patch-notes.ts";

type Sections = { new: string[]; fixes: string[] };

// Horizontal space only: `\s` would run past an empty line and take the next one as the note.
const PORTUGUESE_LINE = /^[ \t]*pt-BR:[ \t]*(\S.*?)[ \t]*$/m;

/** The note on a PR body's `pt-BR: …` line, or null with no such line. */
export const portugueseNote = (body: string): string | null =>
  PORTUGUESE_LINE.exec(body)?.[1] ?? null;

export const localizedNotes = (input: PatchNotesInput): { en: Sections; "pt-BR": Sections } => {
  const sections = notesSections(input);
  const inLanguage = (note: (pr: MergedPr) => string): Sections => ({
    new: sections.new.map(note),
    fixes: sections.fixes.map(note),
  });
  return {
    en: inLanguage((pr) => pr.title),
    "pt-BR": inLanguage((pr) => portugueseNote(pr.body) ?? pr.title),
  };
};

/** Whether a PR the notes will list lacks its Portuguese line. */
export const needsPortugueseNote = (pr: Pick<MergedPr, "body" | "files">): boolean =>
  isListed(pr) && portugueseNote(pr.body) === null;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lines = (text: string) => text.split(/\r?\n/).filter(Boolean);
  const stdin = readFileSync(0, "utf8");
  const [first = "", second = ""] = process.argv.slice(2);
  if (first === "--needs-note") {
    const files = lines(readFileSync(second, "utf8"));
    console.log(needsPortugueseNote({ body: stdin, files }) ? "yes" : "no");
  } else {
    console.log(
      JSON.stringify(
        localizedNotes({
          commits: lines(readFileSync(first, "utf8")),
          bugIssues: lines(readFileSync(second, "utf8")).map(Number),
          pullRequests: lines(stdin).map(parseMergedPr),
        }),
      ),
    );
  }
}
