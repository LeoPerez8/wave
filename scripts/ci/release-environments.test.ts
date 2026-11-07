import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const workflowsDir = fileURLToPath(new URL("../../.github/workflows/", import.meta.url));

/** The secrets that publish to phones; they live only in the `ti` and `main` Environments. */
const RELEASE_SECRETS = ["UPDATES_SIGNING_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];

/** Each job of a workflow file, by name, as the text under its `  <name>:` line. */
const jobsOf = (workflow: string): Map<string, string> => {
  const body = workflow.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length);
  const jobs = new Map<string, string>();
  for (const block of body.split(/\n(?= {2}[\w-]+:\n)/)) {
    const name = /^ {2}([\w-]+):\n/.exec(block)?.[1];
    if (name) jobs.set(name, block);
  }
  return jobs;
};

const workflows = readdirSync(workflowsDir)
  .filter((file) => file.endsWith(".yml"))
  .map((file) => ({ file, text: readFileSync(workflowsDir + file, "utf8") }));

/** The `environment:` line of a job, or undefined. */
const environmentOf = (job: string) => /^ {4}environment: (.+)$/m.exec(job)?.[1];

describe("release secrets", () => {
  it("are read only by jobs that declare a release Environment", () => {
    const readers = workflows.flatMap(({ file, text }) =>
      [...jobsOf(text)]
        .filter(([, job]) => RELEASE_SECRETS.some((name) => job.includes(`secrets.${name}`)))
        .map(([name, job]) => ({ job: `${file} › ${name}`, environment: environmentOf(job) })),
    );
    assert.deepEqual(
      readers.map(({ job }) => job),
      ["ci.yml › release", "rollback.yml › rollback"],
    );
    for (const { job, environment } of readers) {
      assert.ok(environment, `${job} reads a release secret without an Environment`);
    }
  });

  it("are never read at the workflow level, where every job would get them", () => {
    for (const { file, text } of workflows) {
      const top = text.slice(0, text.indexOf("\njobs:\n"));
      for (const name of RELEASE_SECRETS) assert.ok(!top.includes(`secrets.${name}`), file);
    }
  });

  // Only a push to main opens ti, which needs no approval. Every tag run, -ti tags included,
  // takes main and waits for the owner, so a tag on any commit can't publish by itself.
  it("open ti only to pushes to main and main, behind approval, to everything else", () => {
    const release = jobsOf(workflows.find(({ file }) => file === "ci.yml")!.text).get("release")!;
    assert.equal(
      environmentOf(release),
      "${{ github.ref == 'refs/heads/main' && 'ti' || 'main' }}",
    );
    const rollback = jobsOf(workflows.find(({ file }) => file === "rollback.yml")!.text);
    assert.equal(environmentOf(rollback.get("rollback")!), "${{ inputs.channel }}");
  });
});
