import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { completeFiles, unclaimedCommits } from "./merged-prs.ts";
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

describe("completeFiles", () => {
  it("asks for the files of a PR that came without them, and leaves the others", () => {
    const asked: number[] = [];
    const big = { ...pr(20, "merge-20"), files: null };
    const small = { ...pr(21, "merge-21"), files: ["apps/mobile/src/app/_layout.tsx"] };
    const completed = completeFiles([big, small], (number) => {
      asked.push(number);
      return ["apps/desktop/src/main/index.ts", "packages/core/src/index.ts"];
    });
    assert.deepEqual(asked, [20]);
    assert.deepEqual(completed[0]!.files, [
      "apps/desktop/src/main/index.ts",
      "packages/core/src/index.ts",
    ]);
    assert.equal(completed[1], small);
  });

  it("keeps files null when GitHub can't list them either", () => {
    const big = { ...pr(22, "merge-22"), files: null };
    const completed = completeFiles([big], () => {
      throw new Error("HTTP 502");
    });
    assert.equal(completed[0]!.files, null);
  });
});
