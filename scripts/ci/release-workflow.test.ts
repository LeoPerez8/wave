// How CI wires the release gates (docs/release-provenance.md). ci.yml runs the shared jobs and
// calls mobile.yml and desktop.yml, each with its own gate and release. What the phone's gate
// decides is tested in release-gate.test.ts; this checks that the workflows give each gate its
// evidence, that neither app's jobs reach the other's gate, and that nothing reaches a release
// job's secrets around its gate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const FILES = ["ci.yml", "mobile.yml", "desktop.yml"] as const;
type File = (typeof FILES)[number];

const text = Object.fromEntries(
  FILES.map((file) => [
    file,
    readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), "utf8"),
  ]),
) as Record<File, string>;

/** Each job of a workflow file, by name, as the text under its `  <name>:` line. */
const jobsOf = (source: string) =>
  new Map(
    source
      .slice(source.indexOf("\njobs:\n") + "\njobs:\n".length)
      .split(/\n(?= {2}[\w-]+:\n)/)
      .flatMap((block) => {
        const name = /^ {2}([\w-]+):\n/.exec(block)?.[1];
        return name ? [[name, block] as const] : [];
      }),
  );
const jobs = Object.fromEntries(FILES.map((file) => [file, jobsOf(text[file])])) as Record<
  File,
  Map<string, string>
>;
const job = (name: string, file: File = "ci.yml") => {
  const found = jobs[file].get(name);
  assert.ok(found, `${file} has no ${name} job`);
  return found;
};
const needsOf = (name: string, file: File = "ci.yml") =>
  (/^ {4}needs: \[(.*)\]$/m.exec(job(name, file))?.[1] ?? "").split(", ").filter(Boolean);
/** A job's steps, by name (uses: for unnamed ones). */
const stepsOf = (name: string, file: File = "ci.yml") =>
  job(name, file)
    .split(/\n(?= {6}- )/)
    .slice(1)
    .map((step) => ({
      name: /name: (.*)/.exec(step)?.[1] ?? /uses: ([^@\s]+)/.exec(step)?.[1] ?? "",
      text: step,
    }));
const step = (job: string, name: string, file: File = "ci.yml") => {
  const found = stepsOf(job, file).find((step) => step.name === name);
  assert.ok(found, `${file} › ${job} has no "${name}" step`);
  return found.text;
};
const SOURCE = "${{ needs.source.outputs.sha }}";
const INPUT_SOURCE = "${{ inputs.source_sha }}";
/** The jobs both apps share, whose evidence ci.yml hands to each app's workflow. */
const SHARED = ["changes", "checks", "notes", "secret-scan", "source"];

describe("the split", () => {
  it("keeps only the shared jobs in ci.yml and calls one workflow per app", () => {
    assert.deepEqual(
      [...jobs["ci.yml"].keys()].toSorted(),
      [...SHARED, "autofix", "autofix-apply", "desktop", "mobile", "report", "version"].toSorted(),
    );
    assert.match(job("mobile"), /^ {4}uses: \.\/\.github\/workflows\/mobile\.yml$/m);
    assert.match(job("desktop"), /^ {4}uses: \.\/\.github\/workflows\/desktop\.yml$/m);
    for (const file of ["mobile.yml", "desktop.yml"] as const)
      assert.match(text[file], /^on:\n {2}workflow_call:\n/m, file);
  });

  it("hands each app's workflow the shared jobs alone, never the other app's", () => {
    for (const app of ["mobile", "desktop"]) {
      assert.deepEqual(needsOf(app).toSorted(), SHARED, app);
      assert.ok(job(app).includes(`source_sha: ${SOURCE}`), app);
      assert.match(job(app), /release_tag: \$\{\{ needs\.checks\.outputs\.release_tag \}\}/);
      assert.match(job(app), /evidence: \$\{\{ toJSON\(needs\) \}\}/);
    }
    assert.doesNotMatch(text["mobile.yml"], /needs\.(desktop|sign-windows)\b|desktop-release/);
    assert.doesNotMatch(
      text["desktop.yml"],
      /needs\.(android|native-tests)\b|sign-apk|name: release-provenance$/m,
    );
  });

  it("calls each app's workflow on main and tags only when that app changed since its release", () => {
    assert.match(
      job("mobile"),
      /\(github\.event_name == 'pull_request' && needs\.changes\.outputs\.nativeTests == 'true'\) \|\|\n\s+\(github\.event_name != 'pull_request' && needs\.changes\.outputs\.phoneRelease == 'true'\)/,
    );
    assert.match(
      job("desktop"),
      /\(github\.event_name == 'pull_request' && needs\.changes\.outputs\.desktopChecks == 'true'\) \|\|\n\s+\(github\.event_name != 'pull_request' && needs\.changes\.outputs\.desktopRelease == 'true'\)/,
    );
    for (const output of ["phoneRelease", "desktopRelease"])
      assert.ok(job("changes").includes(`${output}: \${{ steps.rule.outputs.${output} }}`));
  });

  it("grants each app's workflow no more than its jobs ask for, and secrets only from Environments", () => {
    for (const app of ["mobile", "desktop"]) {
      assert.match(
        job(app),
        /^ {4}permissions:\n {6}contents: write\n {6}actions: read\n {4}uses:/m,
      );
      assert.match(job(app), /^ {4}secrets: inherit$/m);
    }
    for (const file of ["mobile.yml", "desktop.yml"] as const) {
      assert.match(text[file], /^permissions: \{\}$/m, file);
      for (const [name, body] of jobs[file]) {
        assert.match(body, /^ {4}permissions:\n/m, `${file} › ${name} sets no permissions`);
        assert.doesNotMatch(body, /pull-requests: write|actions: write/, `${file} › ${name}`);
      }
    }
  });

  it("gives each workflow the run's channel, which its scripts read from the environment", () => {
    // ci.yml's Patch notes (patch-notes.sh, earlier-notes.sh) and mobile.yml's Android APK
    // (repack.ts plan) read them; a called workflow doesn't get the caller's env.
    for (const file of ["ci.yml", "mobile.yml"] as const) {
      assert.match(
        text[file],
        /^ {2}IS_TI: \$\{\{ github\.ref == 'refs\/heads\/main' \|\| \(startsWith\(github\.ref, 'refs\/tags\/v'\) && endsWith\(github\.ref, '-ti'\)\) \}\}$/m,
        file,
      );
      assert.match(text[file], /^ {2}IS_RELEASE: /m, file);
    }
  });

  it("posts the reports of both apps' jobs", () => {
    assert.deepEqual(needsOf("report").toSorted(), [
      "autofix",
      "autofix-apply",
      "changes",
      "checks",
      "desktop",
      "mobile",
      "secret-scan",
    ]);
  });
});

describe("the release source", () => {
  it("is chosen once, after the version bump and the autofix commit, with a read-only token", () => {
    assert.deepEqual(needsOf("source"), ["version", "autofix-apply"]);
    // Only a promotion's run reads anything: the commit of the ti release it names.
    assert.match(job("source"), /^ {4}permissions:\n {6}contents: read\n {4}outputs:/m);
    assert.match(
      job("source"),
      /needs\.autofix-apply\.outputs\.sha \|\| needs\.version\.outputs\.sha \|\| github\.event\.pull_request\.head\.sha \|\| github\.sha/,
    );
    assert.match(job("source"), /if \[ -n "\$PROMOTED_FROM" \]; then/);
    assert.match(job("source"), /\[ "\$GITHUB_EVENT_NAME" != workflow_dispatch \]/);
  });

  it("is what every job the gates trust checks out, and each reports what it checked out", () => {
    const trusted: [string, File, string][] = [
      ["secret-scan", "ci.yml", SOURCE],
      ["checks", "ci.yml", SOURCE],
      ["notes", "ci.yml", SOURCE],
      ["native-tests", "mobile.yml", INPUT_SOURCE],
      ["android", "mobile.yml", INPUT_SOURCE],
    ];
    for (const [name, file, ref] of trusted) {
      if (file === "ci.yml") assert.ok(needsOf(name).includes("source"), `${name} doesn't wait`);
      const checkout = stepsOf(name, file).find((step) => step.name === "actions/checkout")!;
      assert.ok(checkout.text.includes(`ref: ${ref}`), `${name} checks out another commit`);
      assert.match(job(name, file), /^ {6}source: \$\{\{ steps\.[\w-]+\.outputs\.source \}\}$/m);
    }
    assert.ok(job("desktop", "desktop.yml").includes(`ref: ${INPUT_SOURCE}`));
  });

  it("is what the secret scan scans up to", () => {
    assert.ok(step("secret-scan", "Scan for secrets").includes(`SOURCE_SHA: ${SOURCE}`));
    assert.match(job("secret-scan"), /fetch-depth: 0/);
  });
});

describe("the phone's release gate", () => {
  it("waits for every prerequisite and runs to refuse even when one failed", () => {
    // The shared jobs reach it through the call's needs, the phone's own through its own.
    assert.deepEqual(needsOf("release-gate", "mobile.yml").toSorted(), ["android", "native-tests"]);
    assert.deepEqual([...needsOf("mobile"), ...needsOf("release-gate", "mobile.yml")].toSorted(), [
      "android",
      "changes",
      "checks",
      "native-tests",
      "notes",
      "secret-scan",
      "source",
    ]);
    assert.match(job("release-gate", "mobile.yml"), /if: >-\n\s+\$\{\{ !cancelled\(\) &&/);
    assert.match(job("mobile"), /if: >-\n\s+\$\{\{ !cancelled\(\) &&/);
  });

  it("admits from the prerequisites' own results, with no Environment or secret", () => {
    const gate = job("release-gate", "mobile.yml");
    const admit = step("release-gate", "Admit the release", "mobile.yml");
    assert.match(admit, /SHARED: \$\{\{ inputs\.evidence \}\}/);
    assert.match(admit, /NEEDS: \$\{\{ toJSON\(needs\) \}\}/);
    assert.match(admit, /\{ \.\.\.shared, \.\.\.own \}/);
    assert.match(gate, /release-gate\.ts admit/);
    assert.doesNotMatch(gate, /environment:|secrets\./);
    assert.match(gate, /^ {6}contents: read$/m);
    assert.doesNotMatch(gate, /: write$/m);
  });
});

describe("the phone's release job", () => {
  it("opens its Environment only after the gate admitted the release", () => {
    assert.ok(needsOf("release", "mobile.yml").includes("release-gate"));
    assert.match(job("release", "mobile.yml"), /needs\.release-gate\.result == 'success'/);
  });

  it("builds on the admitted source, and signs only the admitted APK", () => {
    const steps = stepsOf("release", "mobile.yml");
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
    const names = stepsOf("release", "mobile.yml").map((step) => step.name);
    const check = names.indexOf("Check the update against the gate's record");
    assert.ok(check > names.indexOf("Fetch the over-the-air update"));
    assert.ok(check < names.indexOf("Publish the over-the-air update"));
    assert.match(
      step("release", "Publish the over-the-air update", "mobile.yml"),
      /steps\.update_admitted\.outcome == 'success'/,
    );
    assert.match(step("release", "Publish the release", "mobile.yml"), /PROVENANCE_FILE:/);
  });

  it("publishes the APK alone, whatever the desktop did", () => {
    const release = job("release", "mobile.yml");
    assert.deepEqual(needsOf("release", "mobile.yml"), ["release-gate", "android"]);
    assert.doesNotMatch(release, /desktop-release\.ts|RELEASE_APP|concurrency:/);
    assert.match(
      step("release", "Publish the release", "mobile.yml"),
      /scripts\/ci\/publish-release\.sh "\$RUNNER_TEMP\/release\/\$APK_NAME"\n/,
    );
  });
});

describe("the Android job's provenance", () => {
  it("repacks only a kept build whose record holds, and records each full build it keeps", () => {
    assert.match(
      step("android", "Plan the APK build", "mobile.yml"),
      /KEPT: \$\{\{ steps\.kept_base\.outputs\.base != '' \}\}/,
    );
    assert.match(
      step("android", "Keep the full build for repacks", "mobile.yml"),
      /kept-build\.ts keep/,
    );
  });
});

describe("a promotion", () => {
  it("is admitted only with the sealed record of the ti release it promotes", () => {
    const steps = stepsOf("release-gate", "mobile.yml");
    const names = steps.map((step) => step.name);
    const fetch = names.indexOf("Fetch the promoted ti release's record");
    assert.ok(fetch >= 0 && fetch < names.indexOf("Admit the release"), names.join(", "));
    const text = steps[fetch]!.text;
    // Stable tags only; a ti release has nothing to link.
    assert.match(
      text,
      /startsWith\(github\.ref, 'refs\/tags\/v'\) && !endsWith\(github\.ref, '-ti'\)/,
    );
    // The ti release promote.sh named, by default the stable tag's own number.
    assert.match(text, /promoted="\$\{PROMOTED_FROM:-\$\{GITHUB_REF_NAME\}-ti\}"/);
    assert.match(text, /PROMOTED_FROM: \$\{\{ inputs\.promoted_from \}\}/);
    assert.match(text, /gh release download "\$promoted"/);
    assert.doesNotMatch(text, /secrets\./);
    assert.match(
      step("release-gate", "Admit the release", "mobile.yml"),
      /release-gate\.ts admit "\$RUNNER_TEMP\/needs\.json" "\$RUNNER_TEMP\/promoted\/wave-\$\{promoted#v\}\.provenance\.json" "\$promoted"/,
    );
  });

  it("links the desktop's stable record to the ti release its installers come from", () => {
    const steps = stepsOf("release-gate", "desktop.yml");
    const names = steps.map((step) => step.name);
    const link = names.indexOf("Link the promoted ti release");
    assert.ok(link >= 0 && link < names.indexOf("Create desktop provenance input"), names.join());
    const text = steps[link]!.text;
    assert.match(text, /if: \$\{\{ !endsWith\(inputs\.release_tag, '-ti'\) \}\}/);
    assert.match(text, /release-gate\.ts promote-desktop/);
    assert.doesNotMatch(text, /secrets\./);
    assert.match(
      step("release-gate", "Create desktop provenance input", "desktop.yml"),
      /promotedFrom/,
    );
  });

  it("hands each app the ti release it is built from", () => {
    for (const name of ["mobile", "desktop"])
      assert.match(job(name, "ci.yml"), /promoted_from: \$\{\{ inputs\.promoted_from \}\}/, name);
    assert.match(job("source", "ci.yml"), /PROMOTED_FROM: \$\{\{ inputs\.promoted_from \}\}/);
    assert.match(job("changes", "ci.yml"), /PROMOTED_APP: \$\{\{ inputs\.app \}\}/);
    // Two runs of one promotion on the same tag don't cancel each other.
    assert.match(
      text["ci.yml"],
      /group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\$\{\{ inputs\.app && format\('-\{0\}', inputs\.app\) \|\| '' \}\}/,
    );
  });

  it("checks each app's ti release before it pushes the stable tag", () => {
    const promote = readFileSync(new URL("./promote.sh", import.meta.url), "utf8");
    const tag = promote.indexOf('git tag "$to"');
    for (const check of [
      'verified-release.sh" "$mobile"',
      'verified-desktop-release.sh" "$desktop"',
    ]) {
      const verify = promote.indexOf(check);
      assert.ok(verify > 0, `promote.sh doesn't run ${check}`);
      assert.ok(verify < tag, check);
    }
  });

  it("takes the app and RELEASE_DESKTOP_MAIN from the workflow", () => {
    const workflow = readFileSync(
      new URL("../../.github/workflows/promote.yml", import.meta.url),
      "utf8",
    );
    assert.match(workflow, /options: \[both, mobile, desktop\]\n\s+default: both/);
    assert.match(workflow, /RELEASE_DESKTOP_MAIN: \$\{\{ vars\.RELEASE_DESKTOP_MAIN \}\}/);
    assert.match(workflow, /scripts\/ci\/promote\.sh "\$VERSION" "\$APP"/);
  });
});

describe("a tag run", () => {
  it("of any v* tag, pushed or started by hand, goes through the gates and the main Environment", () => {
    for (const file of ["ci.yml", "mobile.yml"] as const)
      assert.match(
        text[file],
        /IS_RELEASE: \$\{\{ \(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\) && startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/,
        file,
      );
    assert.match(job("release-gate", "mobile.yml"), /startsWith\(github\.ref, 'refs\/tags\/v'\)/);
    // Only a push to main opens ti; a -ti tag made by hand waits for the owner like a stable one.
    for (const [name, file] of [
      ["release", "mobile.yml"],
      ["sign-windows", "desktop.yml"],
      ["release", "desktop.yml"],
    ] as const) {
      assert.match(
        job(name, file),
        /needs\.release-gate\.result == 'success'/,
        `${file} › ${name}`,
      );
      assert.match(
        job(name, file),
        /environment: \$\{\{ github\.ref == 'refs\/heads\/main' && 'ti' \|\| 'main' \}\}/,
        `${file} › ${name}`,
      );
    }
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
      /if \[ "\$APP" = mobile \] && \[ "\$ALLOW_UNRECORDED" = "true" \]; then flags=\(--allow-unrecorded\); fi/,
    );
  });

  it("asks which app to roll back, and touches only that app's files", () => {
    assert.match(
      rollback,
      /app:\n\s+description: .+\n\s+required: true\n\s+type: choice\n\s+options: \[mobile, desktop\]\n/,
    );
    assert.match(named("Promote the update"), /if: inputs\.app == 'mobile'/);
    assert.match(named("Roll back both desktop installers"), /if: inputs\.app == 'desktop'/);
    assert.doesNotMatch(named("Promote the update"), /DESKTOP/);
    assert.doesNotMatch(named("Roll back both desktop installers"), /UPDATES_SIGNING_KEY:/);
  });

  it("keeps its channel's Environment and reads nothing but the repo", () => {
    assert.match(rollback, /^ {4}environment: \$\{\{ inputs\.channel \}\}$/m);
    assert.match(rollback, /^ {6}contents: read$/m);
    assert.doesNotMatch(rollback, /: write$/m);
    assert.match(rollback, /sparse-checkout: \|\n\s+apps\/updates\n\s+scripts\/ci/);
  });

  it("rolls the desktop back on the desktop's own record, with no APK", () => {
    assert.match(
      named("Check the release's provenance"),
      /desktop\) scripts\/ci\/verified-desktop-release\.sh "v\$version" "\$RUNNER_TEMP\/release"/,
    );
    const script = readFileSync(new URL("./verified-desktop-release.sh", import.meta.url), "utf8");
    assert.match(script, /\.desktop\.provenance\.json/);
    assert.match(script, /desktop-release\.ts" names|"\$updates" names/);
    assert.match(script, /"\$updates" verify-published "\$record" "\$dir"/);
    assert.match(
      named("Roll back both desktop installers"),
      /PROVENANCE: \$\{\{ steps\.provenance\.outputs\.file \}\}/,
    );
  });
});

describe("desktop release publication", () => {
  it("signs the admitted app before NSIS, then signs the installer before publication", () => {
    const signer = job("sign-windows", "desktop.yml");
    assert.deepEqual(needsOf("sign-windows", "desktop.yml"), ["release-gate"]);
    assert.match(signer, /needs\.release-gate\.result == 'success'/);
    assert.match(signer, /needs\.release-gate\.outputs\.sign_windows == 'true'/);
    assert.match(signer, /github\.event_name == 'push'/);
    assert.match(signer, /ref: \$\{\{ needs\.release-gate\.outputs\.sha \}\}/);
    const steps = stepsOf("sign-windows", "desktop.yml");
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
    const release = job("release", "desktop.yml");
    assert.ok(needsOf("release", "desktop.yml").includes("sign-windows"));
    assert.match(release, /needs\.sign-windows\.result == 'success'/);
    assert.match(release, /desktop-release\.ts finalize-windows/);
    assert.doesNotMatch(release, /continue-on-error/);

    const packager = readFileSync(
      new URL("../../apps/desktop/scripts/package-release.ts", import.meta.url),
      "utf8",
    );
    assert.match(packager, /differentialPackage: true/);
  });

  it("builds on the release source and keeps stable desktop publication behind its switch", () => {
    const desktop = job("desktop", "desktop.yml");
    const gate = job("release-gate", "desktop.yml");
    assert.deepEqual(needsOf("release-gate", "desktop.yml"), ["desktop"]);
    assert.match(desktop, /ubuntu-22\.04/);
    assert.match(desktop, /windows-latest/);
    assert.match(
      gate,
      /endsWith\(inputs\.release_tag, '-ti'\) \|\| vars\.RELEASE_DESKTOP_MAIN == 'on'/,
    );
    for (const text of [desktop, gate]) assert.doesNotMatch(text, /environment:|secrets\./);
    assert.match(gate, /test "\$DESKTOP_RESULT" = success/);
    assert.match(gate, /desktop-release\.ts admit/);
    assert.doesNotMatch(job("release-gate", "mobile.yml"), /DESKTOP_RESULT|desktop-release\.ts/);
    assert.match(job("release", "desktop.yml"), /needs\.release-gate\.result == 'success'/);
    assert.match(job("release", "desktop.yml"), /desktop-release\.ts verify/);
  });

  it("admits on the same shared evidence as the phone's gate, for the same source", () => {
    const shared = step("release-gate", "Check shared release evidence", "desktop.yml");
    for (const [name, job] of [
      ["SOURCE_RESULT", "source"],
      ["SCAN_RESULT", "['secret-scan']"],
      ["SCAN_SOURCE", "['secret-scan']"],
      ["SCAN_RANGE", "['secret-scan']"],
      ["CHECKS_RESULT", "checks"],
      ["CHECKS_SOURCE", "checks"],
      ["NOTES_RESULT", "notes"],
      ["NOTES_SOURCE", "notes"],
      ["NOTES_OUTCOME", "notes"],
    ] as const)
      assert.ok(
        shared.includes(
          `${name}: \${{ fromJSON(inputs.evidence)${job.startsWith("[") ? job : `.${job}`}`,
        ),
        name,
      );
    for (const name of ["SCAN_SOURCE", "CHECKS_SOURCE", "NOTES_SOURCE"])
      assert.ok(shared.includes(`test "$${name}" = "$SOURCE_SHA"`), name);
    assert.ok(shared.includes('test "$INPUT_SHA" = "$SOURCE_SHA"'));
    assert.match(
      job("release-gate", "desktop.yml"),
      /sha: \$\{\{ steps\.shared\.outputs\.sha \}\}/,
    );
  });

  it("builds the Wave account into the desktop release, and the packager refuses one without it", () => {
    const pack = step("desktop", "Package the desktop release", "desktop.yml");
    for (const name of ["SYNC_URL", "GOOGLE_DESKTOP_CLIENT_ID", "GOOGLE_DESKTOP_CLIENT_SECRET"])
      assert.ok(pack.includes(`MAIN_VITE_WAVE_${name}: \${{ vars.WAVE_${name} }}`), name);
    const packager = readFileSync(
      new URL("../../apps/desktop/scripts/package-release.ts", import.meta.url),
      "utf8",
    );
    assert.match(packager, /Desktop release has no Wave account/);
  });

  it("publishes the admitted installers and their record on its own, then their update", () => {
    const publish = step("release", "Publish the release", "desktop.yml");
    assert.match(publish, /RELEASE_APP: desktop/);
    assert.match(
      publish,
      /PROVENANCE_FILE: \$\{\{ runner\.temp \}\}\/provenance\/provenance\.json/,
    );
    assert.match(publish, /desktop-release\.ts names "\$RELEASE_TAG" "\$RUNNER_TEMP\/desktop"/);
    assert.match(publish, /scripts\/ci\/publish-release\.sh "\$\{desktop\[@\]\}"/);
    const names = stepsOf("release", "desktop.yml").map((step) => step.name);
    assert.ok(names.indexOf("Publish the desktop update") > names.indexOf("Publish the release"));
    assert.match(
      step("release", "Publish the desktop update", "desktop.yml"),
      /if: steps\.published\.outputs\.url != ''[\s\S]*desktop-release\.ts publish "\$RUNNER_TEMP\/provenance\/provenance\.json"/,
    );
    // One desktop publication or rollback at a time per channel (rollback.yml uses the group too).
    assert.match(
      job("release", "desktop.yml"),
      /group: desktop-release-\$\{\{ endsWith\(inputs\.release_tag, '-ti'\) && 'ti' \|\| 'main' \}\}\n\s+cancel-in-progress: false/,
    );
  });
});
