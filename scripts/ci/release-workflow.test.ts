// How ci.yml wires the release gate (docs/release-provenance.md). What the gate decides is
// tested in release-gate.test.ts; this checks that the workflow gives it the evidence and that
// nothing reaches the release job's secrets around it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

/** Each job, by name, as the text under its `  <name>:` line. */
const jobs = new Map(
  workflow
    .slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length)
    .split(/\n(?= {2}[\w-]+:\n)/)
    .flatMap((block) => {
      const name = /^ {2}([\w-]+):\n/.exec(block)?.[1];
      return name ? [[name, block] as const] : [];
    }),
);
const job = (name: string) => {
  const text = jobs.get(name);
  assert.ok(text, `ci.yml has no ${name} job`);
  return text;
};
const needsOf = (name: string) =>
  (/^ {4}needs: \[(.*)\]$/m.exec(job(name))?.[1] ?? "").split(", ").filter(Boolean);
/** A job's steps, by name (uses: for unnamed ones). */
const stepsOf = (name: string) =>
  job(name)
    .split(/\n(?= {6}- )/)
    .slice(1)
    .map((step) => ({
      name: /name: (.*)/.exec(step)?.[1] ?? /uses: ([^@\s]+)/.exec(step)?.[1] ?? "",
      text: step,
    }));
const SOURCE = "${{ needs.source.outputs.sha }}";

describe("the release source", () => {
  it("is chosen once, after the version bump and the autofix commit, with no token", () => {
    assert.deepEqual(needsOf("source"), ["version", "autofix-apply"]);
    assert.match(job("source"), /^ {4}permissions: \{\}$/m);
    assert.match(
      job("source"),
      /needs\.autofix-apply\.outputs\.sha \|\| needs\.version\.outputs\.sha \|\| github\.event\.pull_request\.head\.sha \|\| github\.sha/,
    );
  });

  it("is what every job the gate trusts checks out, and each reports what it checked out", () => {
    for (const name of ["secret-scan", "checks", "native-tests", "notes", "android"]) {
      assert.ok(needsOf(name).includes("source"), `${name} doesn't wait for the source`);
      const checkout = stepsOf(name).find((step) => step.name === "actions/checkout")!;
      assert.ok(checkout.text.includes(`ref: ${SOURCE}`), `${name} checks out another commit`);
      assert.match(job(name), /^ {6}source: \$\{\{ steps\.[\w-]+\.outputs\.source \}\}$/m, name);
    }
  });

  it("is what the secret scan scans up to", () => {
    const step = stepsOf("secret-scan").find((step) => step.name === "Scan for secrets")!;
    assert.ok(step.text.includes(`SOURCE_SHA: ${SOURCE}`));
    assert.match(job("secret-scan"), /fetch-depth: 0/);
  });
});

describe("the release gate", () => {
  it("waits for every prerequisite and runs to refuse even when one failed", () => {
    assert.deepEqual(needsOf("release-gate").toSorted(), [
      "android",
      "changes",
      "checks",
      "native-tests",
      "notes",
      "secret-scan",
      "source",
    ]);
    assert.match(job("release-gate"), /if: >-\n\s+\$\{\{ !cancelled\(\) &&/);
  });

  it("admits from the prerequisites' own results, with no Environment or secret", () => {
    const gate = job("release-gate");
    assert.match(gate, /toJSON\(needs\)/);
    assert.match(gate, /release-gate\.ts admit/);
    assert.doesNotMatch(gate, /environment:|secrets\./);
    assert.match(gate, /^ {6}contents: read$/m);
    assert.doesNotMatch(gate, /: write$/m);
  });
});

describe("the release job", () => {
  it("opens its Environment only after the gate admitted the release", () => {
    assert.ok(needsOf("release").includes("release-gate"));
    assert.match(job("release"), /needs\.release-gate\.result == 'success'/);
  });

  it("builds on the admitted source, and signs only the admitted APK", () => {
    const steps = stepsOf("release");
    assert.ok(
      steps
        .find((step) => step.name === "actions/checkout")!
        .text.includes("ref: ${{ needs.release-gate.outputs.sha }}"),
    );
    const names = steps.map((step) => step.name);
    const verify = names.indexOf("Check the APK against the gate's record");
    assert.ok(verify > 0 && verify < names.indexOf("Sign the APK"), names.join(", "));
    // Before signing, nothing runs but the checkout, the downloads and the check.
    for (const step of steps.slice(0, names.indexOf("Sign the APK")))
      assert.doesNotMatch(step.text, /secrets\./, step.name);
  });

  it("publishes only the admitted update, and carries the record with the release", () => {
    const names = stepsOf("release").map((step) => step.name);
    const check = names.indexOf("Check the update against the gate's record");
    assert.ok(check > names.indexOf("Fetch the over-the-air update"));
    assert.ok(check < names.indexOf("Publish the over-the-air update"));
    assert.match(
      stepsOf("release").find((step) => step.name === "Publish the over-the-air update")!.text,
      /steps\.update_admitted\.outcome == 'success'/,
    );
    assert.match(
      stepsOf("release").find((step) => step.name === "Publish the release")!.text,
      /PROVENANCE_FILE:/,
    );
  });
});

describe("the Android job's provenance", () => {
  it("repacks only a kept build whose record holds, and records each full build it keeps", () => {
    const steps = stepsOf("android");
    const plan = steps.find((step) => step.name === "Plan the APK build")!;
    assert.match(plan.text, /KEPT: \$\{\{ steps\.kept_base\.outputs\.base != '' \}\}/);
    assert.match(
      steps.find((step) => step.name === "Keep the full build for repacks")!.text,
      /kept-build\.ts keep/,
    );
  });
});
