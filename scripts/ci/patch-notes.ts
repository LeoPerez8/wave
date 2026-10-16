// A release's patch notes, built from the PRs merged since the previous version's tag:
// "New" and "Fixes", one line per PR, its title linked to it. patch-notes.sh gathers the
// release's commits (one per line), the issues labelled bug (one per line) and the
// merged PRs (one MergedPr JSON per line, on stdin):
//   <prs> | node scripts/ci/patch-notes.ts <commits file> <bug issues file>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { reachesUsers } from "./changes.ts";

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

const isMergedPr = (value: unknown): value is MergedPr =>
  typeof value === "object" &&
  value !== null &&
  "number" in value &&
  typeof value.number === "number" &&
  Number.isSafeInteger(value.number) &&
  "title" in value &&
  typeof value.title === "string" &&
  "url" in value &&
  typeof value.url === "string" &&
  "branch" in value &&
  typeof value.branch === "string" &&
  "base" in value &&
  typeof value.base === "string" &&
  "body" in value &&
  typeof value.body === "string" &&
  "mergeCommit" in value &&
  typeof value.mergeCommit === "string" &&
  "files" in value &&
  (value.files === null ||
    (Array.isArray(value.files) &&
      value.files.every((path: unknown) => typeof path === "string"))) &&
  "issues" in value &&
  Array.isArray(value.issues) &&
  value.issues.every((issue: unknown) => typeof issue === "number" && Number.isSafeInteger(issue));

const parseMergedPr = (line: string, index: number): MergedPr => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error(`Invalid merged PR on line ${index + 1}: expected valid JSON.`);
  }
  if (!isMergedPr(value))
    throw new Error(
      `Invalid merged PR on line ${index + 1}: expected an integer number; string title, url, branch, base, body and mergeCommit; files as a string array or null; and issues as an integer array.`,
    );
  return value;
};

// GitHub links closed issues only for PRs into the default branch, so a PR into a
// feature's branch names its issue in the body ("Closes #12") and nowhere else.
const CLOSING_KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)/gi;

const closedIssues = (pr: MergedPr) => [
  ...pr.issues,
  ...Array.from(pr.body.matchAll(CLOSING_KEYWORD), (match) => Number(match[1])),
];

// Users see what changes the APK or the sync service. A PR that changes only CI, docs or
// specs (by the change rule) isn't news to them. `files` is null when GitHub couldn't list
// them all.
const isListed = (pr: MergedPr) => pr.files === null || reachesUsers(pr.files);

// A title is plain text with `code` in it: Markdown would drop "<version>" as an HTML
// tag and let brackets end the link early.
const linkText = (title: string) =>
  title
    .split(/(`[^`]*`)/)
    .map((part) => (part.startsWith("`") ? part : part.replace(/[\\<>[\]]/g, "\\$&")))
    .join("");

const section = (heading: string, prs: readonly MergedPr[]) =>
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
      pullRequests: lines(readFileSync(0, "utf8")).map(parseMergedPr),
    }),
  );
}
