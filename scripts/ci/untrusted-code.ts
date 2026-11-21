// What a workflow would hand to code nobody trusted yet: a fork's PR runs with GitHub's
// read-only token and no secrets only while every workflow keeps to these rules
// (docs/contributing.md, Outside contributions).
//   node scripts/ci/untrusted-code.ts [workflow dir, default .github/workflows]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The events a workflow may start on. `pull_request` gives a fork's PR a read-only token and
 * no secrets; the others start only from a push or a run by someone with write access.
 * `workflow_call` starts nothing itself: a workflow in this repo (ci.yml) calls it as one of its
 * jobs, with the caller's event and no more token than the calling job has, so these rules
 * still hold through the caller. Events such as `pull_request_target` or `workflow_run` run with
 * the base repository's token and secrets while reading what a fork sent, so adding one needs
 * its own review.
 */
const ALLOWED_TRIGGERS = new Set(["pull_request", "push", "workflow_dispatch", "workflow_call"]);

/** A line without its trailing `# comment`, trimmed: empty for a blank or comment line. */
const valueOf = (line: string): string => line.replace(/(^|[ \t])#.*$/, "").trim();

const indentOf = (line: string): number => /^ */.exec(line)![0].length;

/** A mapping key or sequence item's name: `  - "push": # x` → `push`. */
const nameOf = (line: string): string =>
  valueOf(line)
    .replace(/^-[ \t]*/, "")
    .replace(/:.*$/, "")
    .replace(/^(["'])(.*)\1$/, "$2");

/** Each top-level `<key>:` line, by index, with what follows the colon. */
const topLevel = (lines: string[], key: string) =>
  lines.flatMap((line, index) => {
    const match = new RegExp(`^(["']?)${key}\\1:(.*)$`).exec(line);
    return match ? [{ index, value: valueOf(match[2]!) }] : [];
  });

/** The entries nested under lines[at]: each line at the block's indentation, with those below it. */
const entriesUnder = (lines: string[], at: number) => {
  const entries: { name: string; body: string[] }[] = [];
  let indent = -1;
  for (const line of lines.slice(at + 1)) {
    if (valueOf(line) === "") continue;
    const depth = indentOf(line);
    if (depth === 0) break;
    if (indent < 0) indent = depth;
    if (depth <= indent) entries.push({ name: nameOf(line), body: [] });
    else entries.at(-1)?.body.push(line);
  }
  return entries;
};

/** The events under the workflow's `on:`, in either the block or the inline form. */
const triggersOf = (lines: string[]): string[] =>
  topLevel(lines, "on").flatMap(({ index, value }) =>
    value
      ? value
          .replace(/[[\]]/g, "")
          .split(",")
          .map((name) => name.trim())
      : entriesUnder(lines, index).map((entry) => entry.name),
  );

/** Each rule [workflow] breaks, as a short label; empty when it keeps them all. */
export function untrustedCodeExposures(workflow: string): string[] {
  const lines = workflow.split(/\r\n?|\n/);
  const found = triggersOf(lines)
    .filter((name) => !ALLOWED_TRIGGERS.has(name))
    .map((name) => `trigger ${name}`);
  // Without it, every job gets the repository's default token, whatever that is set to.
  const permissions = topLevel(lines, "permissions");
  if (permissions.length === 0 || permissions.some(({ value }) => !/^\{\s*\}$/.test(value))) {
    found.push("workflow permissions not {}");
  }
  for (const { index } of topLevel(lines, "jobs")) {
    for (const { name, body } of entriesUnder(lines, index)) {
      const keys = body.filter((line) => indentOf(line) === indentOf(body[0] ?? ""));
      const asked = keys.filter((line) => nameOf(line) === "permissions");
      if (asked.length === 0) found.push(`job ${name} has no permissions`);
      else if (asked.some((line) => valueOf(line.replace(/^[^:]*:/, "")) === "write-all"))
        found.push(`job ${name} permissions write-all`);
    }
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? ".github/workflows";
  const found = readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) =>
      untrustedCodeExposures(readFileSync(join(dir, file), "utf8")).map(
        (rule) => `${file}: ${rule}`,
      ),
    );
  for (const line of found) console.error(line);
  if (found.length === 0) console.log("Every workflow keeps PR code to a read-only token.");
  process.exit(found.length > 0 ? 1 : 0);
}
