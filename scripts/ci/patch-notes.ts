// A release's patch notes, built from the PRs merged since the previous version's tag:
// "New" and "Fixes", one line per PR, its title linked to it. patch-notes.sh gathers the
// release's commits (one per line), the issues labelled bug (one per line) and the
// merged PRs (one MergedPr JSON per line, on stdin):
//   <prs> | node scripts/ci/patch-notes.ts <commits file> <bug issues file>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { changes } from "./changes.ts";

export type MergedPr = {
  number: number;
  title: string;
  url: string;
  branch: string;
  base: string;
  body: string;
  mergeCommit: string;
  files: readonly string[] | null;
  issues: readonly number[];
};

export type PatchNotesInput = {
  commits: readonly string[];
  bugIssues: readonly number[];
  pullRequests: readonly MergedPr[];
};

// GitHub links closed issues only for PRs into the default branch, so a PR into a
// feature's branch names its issue in the body ("Closes #12") and nowhere else.
const CLOSING_KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)/gi;

const closedIssues = (pr: MergedPr) => [
  ...pr.issues,
  ...Array.from(pr.body.matchAll(CLOSING_KEYWORD), (match) => Number(match[1])),
];

// Users see what changes the APK. A PR that changes only CI, docs or specs (by the
// change rule) isn't news to them. `files` is null when GitHub couldn't list them all.
const isListed = (pr: MergedPr) => {
  if (pr.files === null) return true;
  const touched = changes(pr.files);
  return touched.app || touched.core || touched.workspace;
};

// A title is plain text with `code` in it: Markdown would drop "<version>" as an HTML
// tag and let brackets end the link early.
const linkText = (title: string) =>
  title
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith("`") ? part : part.replace(/[\\<>[\]]/g, "\\$&")))
    .join("");

const section =(heading: string, prs: readonly MergedPr[]) =>
  prs.length === 0
    ? []
    : [`## ${heading}\n\n${prs.map((pr) => `- [${linkText(pr.title)}](${pr.url})\n`).join("")}`];

export const patchNotes = ({ commits, bugIssues, pullRequests }: PatchNotesInput): string => {
  const inRelease = new Set(commits);
  const bugs = new Set(bugIssues);
  const isFix = (pr: MergedPr) =>
    pr.branch.startsWith("fix/") || closedIssues(pr).some((issue) => bugs.has(issue));
  const merged = pullRequests.filter((pr) => inRelease.has(pr.mergeCommit));
  // A feature built on its own branch reaches main as one PR, and its tickets' PRs
  // into that branch already say what it brings.
  const featureBranches = new Set(merged.map((pr) => pr.base));
  const listed = merged
    .filter((pr) => !featureBranches.has(pr.branch) && isListed(pr))
    .toSorted((a, b) => a.number - b.number);
  return [
    ...section(
      "New",
      listed.filter((pr) => !isFix(pr)),
    ),
    ...section("Fixes", listed.filter(isFix)),
  ].join("\n");
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [commitsFile = "", bugIssuesFile = ""] = process.argv.slice(2);
  const lines = (text: string) => text.split(/\r?\n/).filter(Boolean);
  process.stdout.write(
    patchNotes({
      commits: lines(readFileSync(commitsFile, "utf8")),
      bugIssues: lines(readFileSync(bugIssuesFile, "utf8")).map(Number),
      pullRequests: lines(readFileSync(0, "utf8")).map((line) => JSON.parse(line)),
    }),
  );
}
