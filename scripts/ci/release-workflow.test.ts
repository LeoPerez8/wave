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
      "desktop",
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

describe("a promotion", () => {
  it("is admitted only with the sealed record of the ti release it promotes", () => {
    const steps = stepsOf("release-gate");
    const names = steps.map((step) => step.name);
    const fetch = names.indexOf("Fetch the promoted ti release's record");
    assert.ok(fetch >= 0 && fetch < names.indexOf("Admit the release"), names.join(", "));
    const step = steps[fetch]!.text;
    // Stable tags only; a ti release has nothing to link.
    assert.match(
      step,
      /startsWith\(github\.ref, 'refs\/tags\/v'\) && !endsWith\(github\.ref, '-ti'\)/,
    );
    assert.match(step, /gh release download "\$\{GITHUB_REF_NAME\}-ti"/);
    assert.doesNotMatch(step, /secrets\./);
    assert.match(
      steps.find((step) => step.name === "Admit the release")!.text,
      /release-gate\.ts admit "\$RUNNER_TEMP\/needs\.json" "\$RUNNER_TEMP\/promoted\/wave-\$\{GITHUB_REF_NAME#v\}-ti\.provenance\.json"/,
    );
  });

  it("checks the ti release before it pushes the stable tag", () => {
    const promote = readFileSync(new URL("./promote.sh", import.meta.url), "utf8");
    const verify = promote.indexOf('verified-release.sh" "$from"');
    assert.ok(verify > 0, "promote.sh doesn't check the ti release");
    assert.ok(verify < promote.indexOf('git tag "$to"'));
  });
});

describe("a tag run", () => {
  it("of any v* tag, pushed or started by hand, goes through the gate and the main Environment", () => {
    assert.match(
      workflow,
      /IS_RELEASE: \$\{\{ \(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\) && startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/,
    );
    assert.match(job("release-gate"), /startsWith\(github\.ref, 'refs\/tags\/v'\)/);
    assert.match(job("release"), /needs\.release-gate\.result == 'success'/);
    // Only a push to main opens ti; a -ti tag made by hand waits for the owner like a stable one.
    assert.match(
      job("release"),
      /environment: \$\{\{ github\.ref == 'refs\/heads\/main' && 'ti' \|\| 'main' \}\}/,
    );
  });
});

describe("a rollback", () => {
  const rollback = readFileSync(
    new URL("../../.github/workflows/rollback.yml", import.meta.url),
    "utf8",
  );
  const steps = rollback
    .slice(rollback.indexOf("    steps:\n"))
    .split(/\n(?= {6}- )/)
    .slice(1)
    .map((step) => ({ name: /name: (.*)/.exec(step)?.[1] ?? "", text: step }));
  const named = (name: string) => {
    const step = steps.find((step) => step.name === name);
    assert.ok(step, `rollback.yml has no "${name}" step`);
    return step.text;
  };

  it("checks the release's record before any step that holds a secret", () => {
    const names = steps.map((step) => step.name);
    const check = names.indexOf("Check the release's provenance");
    assert.ok(check >= 0 && check < names.indexOf("Promote the update"), names.join(", "));
    for (const step of steps.slice(0, check + 1)) assert.doesNotMatch(step.text, /secrets\./);
    assert.match(
      named("Check the release's provenance"),
      /scripts\/ci\/verified-release\.sh "v\$version"/,
    );
  });

  it("hands the checked record to the promotion, which checks R2's update against it", () => {
    const promote = named("Promote the update");
    assert.match(promote, /WAVE_PROVENANCE_FILE: \$\{\{ steps\.provenance\.outputs\.file \}\}/);
    assert.match(promote, /WAVE_ALLOW_UNRECORDED: \$\{\{ inputs\.allow_unrecorded \}\}/);
  });

  it("lets a release without a record through only when the owner asks, off by default", () => {
    assert.match(
      rollback,
      /allow_unrecorded:\n\s+description: .+\n\s+required: false\n\s+type: boolean\n\s+default: false/,
    );
    assert.match(
      named("Check the release's provenance"),
      /if \[ "\$TARGET" = android \] && \[ "\$ALLOW_UNRECORDED" = "true" \]; then flags=\(--allow-unrecorded\); fi/,
    );
  });

  it("keeps its channel's Environment and reads nothing but the repo", () => {
    assert.match(rollback, /^ {4}environment: \$\{\{ inputs\.channel \}\}$/m);
    assert.match(rollback, /^ {6}contents: read$/m);
    assert.doesNotMatch(rollback, /: write$/m);
    assert.match(rollback, /sparse-checkout: \|\n\s+apps\/updates\n\s+scripts\/ci/);
  });
});

describe("desktop release publication", () => {
  it("signs the admitted app before NSIS, then signs the installer before publication", () => {
    const signer = job("sign-windows");
    assert.deepEqual(needsOf("sign-windows"), ["release-gate", "checks"]);
    assert.match(signer, /needs\.release-gate\.result == 'success'/);
    assert.match(signer, /needs\.release-gate\.outputs\.sign_windows == 'true'/);
    assert.match(signer, /github\.event_name == 'push'/);
    assert.match(signer, /ref: \$\{\{ needs\.release-gate\.outputs\.sha \}\}/);
    const steps = stepsOf("sign-windows");
    const names = steps.map((step) => step.name);
    const ordered = [
      "Verify the admitted Windows app payload",
      "Sign Wave.exe",
      "Build NSIS with the signed Wave.exe",
      "Sign the NSIS installer",
      "Verify the signed installer and generate its blockmap",
    ].map((name) => names.indexOf(name));
    assert.ok(ordered[0]! >= 0);
    assert.deepEqual(
      ordered,
      [...new Set(ordered)].sort((a, b) => a - b),
    );
    for (const [name, upload] of [
      ["Sign Wave.exe", "unsigned-app"],
      ["Sign the NSIS installer", "unsigned-installer"],
    ]) {
      const text = steps.find((step) => step.name === name)!.text;
      assert.match(text, /SignPath\/github-action-submit-signing-request@[0-9a-f]{40}/);
      assert.ok(text.includes(`steps.${upload}.outputs.artifact-id`));
      assert.match(text, /wait-for-completion: true/);
    }
    assert.ok(needsOf("release").includes("sign-windows"));
    assert.match(job("release"), /needs\.sign-windows\.result == 'success'/);
    assert.match(job("release"), /desktop-release\.ts finalize-windows/);

    const packager = readFileSync(
      new URL("../../apps/desktop/scripts/package-release.ts", import.meta.url),
      "utf8",
    );
    assert.match(packager, /differentialPackage: true/);
  });

  it("builds on the release source and keeps stable desktop publication behind its switch", () => {
    const desktop = job("desktop");
    const gate = job("release-gate");
    assert.ok(desktop.includes(`ref: ${SOURCE}`));
    assert.match(desktop, /ubuntu-22\.04/);
    assert.match(desktop, /windows-latest/);
    for (const text of [desktop, gate]) {
      assert.match(
        text,
        /endsWith\(needs\.checks\.outputs\.release_tag, '-ti'\) \|\| vars\.RELEASE_DESKTOP_MAIN == 'on'/,
      );
      assert.doesNotMatch(text, /environment:|secrets\./);
    }
    assert.match(gate, /test "\$DESKTOP_RESULT" = success/);
    assert.match(gate, /desktop-release\.ts admit/);
    assert.match(job("release"), /desktop-release\.ts verify/);
  });

  it("attaches the admitted installers and blockmap to the versioned release", () => {
    const publish = stepsOf("release").find((step) => step.name === "Publish the release")!.text;
    assert.match(publish, /DESKTOP_ADMITTED: \$\{\{ needs\.release-gate\.outputs\.desktop \}\}/);
    assert.match(publish, /if \[ "\$DESKTOP_ADMITTED" = "true" \]; then/);
    assert.match(publish, /desktop-release\.ts names "\$RELEASE_TAG" "\$RUNNER_TEMP\/desktop"/);
    assert.match(publish, /publish-release\.sh.*"\$\{desktop\[@\]\}"/);
  });
});
