// Which of a branch's commits merged-prs.sh asks GitHub about one by one: GitHub's search
// can lag a minute or more behind a merge, so the PR a push just merged may be missing from
// it. merged-prs.sh passes the branch's first-parent commits in the range (one per line,
// where every PR merged into the branch lands) and the PRs the search found (one MergedPr
// JSON per line, on stdin):
//   <prs> | node scripts/ci/merged-prs.ts <commits file>
// Prints the commits no found PR was merged by, one per line.
// With --complete-files <owner/repo>, it reads MergedPr lines instead and prints them back with
// the files of those that came without them (more than the search lists) asked of GitHub.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseMergedPr, type MergedPr } from "./patch-notes.ts";

/** The commits, in order, that none of the PRs found was merged by. */
export const unclaimedCommits = (
  commits: readonly string[],
  found: readonly MergedPr[],
): string[] => {
  const claimed = new Set(found.map((pr) => pr.mergeCommit));
  return commits.filter((commit) => !claimed.has(commit));
};

/**
 * The PRs, with the files of those that came without them asked of [listFiles]. A PR whose
 * files it can't list either keeps null, which the patch notes read as "may reach users".
 */
export const completeFiles = (
  prs: readonly MergedPr[],
  listFiles: (number: number) => readonly string[],
): MergedPr[] =>
  prs.map((pr) => {
    if (pr.files !== null) return pr;
    try {
      return { ...pr, files: listFiles(pr.number) };
    } catch {
      return pr;
    }
  });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lines = (text: string) => text.split(/\r?\n/).filter(Boolean);
  const [first = "", repo = ""] = process.argv.slice(2);
  const found = lines(readFileSync(0, "utf8")).map(parseMergedPr);
  if (first === "--complete-files") {
    // GitHub's REST API lists up to 3,000 files of a PR.
    const listFiles = (number: number) =>
      lines(
        execFileSync(
          "gh",
          ["api", `repos/${repo}/pulls/${number}/files`, "--paginate", "--jq", ".[].filename"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
        ),
      );
    for (const pr of completeFiles(found, listFiles)) console.log(JSON.stringify(pr));
  } else {
    const commits = lines(readFileSync(first, "utf8"));
    for (const commit of unclaimedCommits(commits, found)) console.log(commit);
  }
}
