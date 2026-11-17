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
 * Events such as `pull_request_target` or `workflow_run` run with the base repository's token
 * and secrets while reading what a fork sent, so adding one needs its own review.
 */
const ALLOWED_TRIGGERS = new Set(["pull_request", "push", "workflow_dispatch"]);

/** The events under the workflow's `on:`, in either the block or the inline form. */
const triggersOf = (workflow: string): string[] => {
  const inline = /^on:[ \t]*(\S.*)$/m.exec(workflow)?.[1];
  if (inline)
    return inline
      .replace(/[[\]]/g, "")
      .split(",")
      .map((name) => name.trim());
  const block = /^on:[ \t]*\n((?:[ \t]+.*\n?|\s*\n)*)/m.exec(workflow)?.[1] ?? "";
  return [...block.matchAll(/^ {2}([\w-]+):/gm)].map((match) => match[1]!);
};

/** Each job of the workflow, by name, as the text under its `  <name>:` line. */
const jobsOf = (workflow: string): Map<string, string> => {
  const start = workflow.indexOf("\njobs:\n");
  const jobs = new Map<string, string>();
  if (start < 0) return jobs;
  const body = workflow.slice(start + "\njobs:\n".length).split(/\n(?=\S)/)[0]!;
  for (const block of body.split(/\n(?= {2}[\w-]+:[ \t]*(?:#.*)?\n)/)) {
    const name = /^ {2}([\w-]+):/.exec(block)?.[1];
    if (name) jobs.set(name, block);
  }
  return jobs;
};

/** Each rule [workflow] breaks, as a short label; empty when it keeps them all. */
export function untrustedCodeExposures(workflow: string): string[] {
  const found = triggersOf(workflow)
    .filter((name) => !ALLOWED_TRIGGERS.has(name))
    .map((name) => `trigger ${name}`);
  // Without it, every job gets the repository's default token, whatever that is set to.
  if (!/^permissions:[ \t]*\{\}[ \t]*(#.*)?$/m.test(workflow)) {
    found.push("workflow permissions not {}");
  }
  for (const [name, job] of jobsOf(workflow)) {
    if (!/^ {4}permissions:/m.test(job)) found.push(`job ${name} has no permissions`);
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
