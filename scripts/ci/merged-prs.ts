// Which of a branch's commits merged-prs.sh asks GitHub about one by one: GitHub's search
// can lag a minute or more behind a merge, so the PR a push just merged may be missing from
// it. merged-prs.sh passes the branch's first-parent commits in the range (one per line,
// where every PR merged into the branch lands) and the PRs the search found (one MergedPr
// JSON per line, on stdin):
//   <prs> | node scripts/ci/merged-prs.ts <commits file>
// Prints the commits no found PR was merged by, one per line.
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lines = (text: string) => text.split(/\r?\n/).filter(Boolean);
  const commits = lines(readFileSync(process.argv[2] ?? "", "utf8"));
  const found = lines(readFileSync(0, "utf8")).map(parseMergedPr);
  for (const commit of unclaimedCommits(commits, found)) console.log(commit);
}
