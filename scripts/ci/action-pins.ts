// Fails when a workflow uses an action, or a reusable workflow, by anything but a full commit
// SHA: a tag or branch can move to other code. Local actions are part of the checkout, and a
// Docker image counts only when it's pinned by digest. Dependabot keeps the SHAs current.
//   node scripts/ci/action-pins.ts [workflow dir, default .github/workflows]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type Unpinned = { line: number; uses: string };

const usesLine = /^\s*(?:-\s+)?uses:\s*(.+?)\s*$/;
const pinnedByCommit = /@[0-9a-f]{40}$/;
const pinnedByDigest = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;

export function unpinnedActions(workflow: string): Unpinned[] {
  const found: Unpinned[] = [];
  workflow.split("\n").forEach((text, index) => {
    const value = usesLine.exec(text.replace(/\s#.*$/, ""))?.[1];
    if (!value) return;
    const uses = value.replace(/^(["'])(.*)\1$/, "$2");
    if (uses.startsWith("./")) return;
    if (uses.startsWith("docker://") ? pinnedByDigest.test(uses) : pinnedByCommit.test(uses))
      return;
    found.push({ line: index + 1, uses });
  });
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? ".github/workflows";
  const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));
  let failed = false;
  for (const name of files) {
    for (const { line, uses } of unpinnedActions(readFileSync(join(dir, name), "utf8"))) {
      failed = true;
      console.error(
        `::error file=${join(dir, name)},line=${line}::${uses} isn't pinned by a commit SHA.`,
      );
    }
  }
  if (failed) process.exit(1);
  console.log(`Every action in ${files.length} workflows is pinned by a commit SHA.`);
}
