import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unclaimedCommits } from "./merged-prs.ts";
import type { MergedPr } from "./patch-notes.ts";

const pr = (number: number, mergeCommit: string): MergedPr => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/LeoPerez8/wave/pull/${number}`,
  branch: `fix/${number}`,
  base: "main",
  body: "",
  mergeCommit,
  files: [],
  issues: [],
});

describe("unclaimedCommits", () => {
  it("is the branch's commits that no PR the search found was merged by, in order", () => {
    const commits = ["bump-2", "merge-14", "merge-13", "bump-1", "merge-12"];
    const found = [pr(12, "merge-12"), pr(13, "merge-13"), pr(9, "elsewhere")];
    assert.deepEqual(unclaimedCommits(commits, found), ["bump-2", "merge-14", "bump-1"]);
  });
});
