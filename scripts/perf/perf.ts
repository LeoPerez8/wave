// Wave's release performance runner (docs/performance/README.md).
//   node scripts/perf/perf.ts scenarios
//   node scripts/perf/perf.ts doctor [--serial <s>] [--dry-run]
//   node scripts/perf/perf.ts run [--scenario all|<a,b>] [--variant idle|import|idle,import]
//        [--label <l>] [--iterations <n>] [--commit <sha>] [--apk <file>] [--import-link <url>]
//        [--compile <filter>] [--perfetto] [--meta key=value]... [--out <file>] [--serial <s>]
//        [--dry-run]
//   node scripts/perf/perf.ts summary <results.jsonl>
//   node scripts/perf/perf.ts compare <before.jsonl> <after.jsonl>
//   node scripts/perf/perf.ts profile generate --apk <unminified release APK> [--commit <sha>]
//        [--iterations <n>] [--serial <s>] [--dry-run]
//   node scripts/perf/perf.ts profile check-apk <apk> [--mapping <mapping.txt>] [--min-coverage <0-1>]
//   node scripts/perf/perf.ts profile device [--install] [--serial <s>] [--dry-run]
//   node scripts/perf/perf.ts profile status
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { adbDevice, installApk, listDevices } from "./adb.ts";
import {
  checkApkProfile,
  formatProfile,
  looksMinified,
  parseProfileText,
  readApkProfile,
  type ProfileRules,
} from "./artProfile.ts";
import { parsePackage, parseRefreshRate, parseThermalStatus } from "./device.ts";
import { FakeDevice } from "./fakeDevice.ts";
import { compareSummaries, formatComparison, formatSummary, summarize } from "./metrics.ts";
import { compileWithBaseline, generateProfiles, readProfileState } from "./profileDevice.ts";
import { comparability, readResults, type Results } from "./results.ts";
import { runPerf, type Device } from "./runner.ts";
import { ALL_SCENARIOS, SCENARIOS, VARIANTS, type Variant } from "./scenarios.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..", "..");

interface Fixture {
  readonly package: string;
  readonly tabs: readonly string[];
  readonly importLink: string | null;
  readonly settleMs: number;
  readonly windowMs: number;
  readonly launchSettleMs: number;
  readonly memoryIdleMs: number;
  readonly flushTimeoutMs: number;
}

const fixture = JSON.parse(readFileSync(join(here, "fixture.json"), "utf8")) as Fixture;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    serial: { type: "string" },
    scenario: { type: "string", default: "all" },
    variant: { type: "string", default: "idle" },
    label: { type: "string", default: "run" },
    iterations: { type: "string" },
    commit: { type: "string" },
    apk: { type: "string" },
    "import-link": { type: "string" },
    compile: { type: "string" },
    perfetto: { type: "boolean", default: false },
    meta: { type: "string", multiple: true, default: [] },
    out: { type: "string" },
    mapping: { type: "string" },
    "min-coverage": { type: "string", default: "0.9" },
    install: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const gitCommit = (): string | null => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
};

/** The phone to use: --serial, or the only one attached. */
const pickDevice = async (): Promise<Device> => {
  if (values["dry-run"]) return new FakeDevice({ tabs: [...fixture.tabs, "Search"] });
  const devices = await listDevices();
  const ready = devices.filter((device) => device.state === "device");
  const serial = values.serial ?? (ready.length === 1 ? ready[0]?.serial : undefined);
  if (serial === undefined)
    return fail(
      ready.length === 0
        ? `No phone attached (adb devices: ${devices.map((d) => `${d.serial} ${d.state}`).join(", ") || "none"}).` +
            " Use --dry-run to check the runner without one."
        : `Several phones attached (${ready.map((d) => d.serial).join(", ")}): pick one with --serial.`,
    );
  if (!ready.some((device) => device.serial === serial))
    return fail(
      `${serial} isn't ready (adb devices says: ${devices.find((d) => d.serial === serial)?.state ?? "absent"}).`,
    );
  return adbDevice(serial);
};

const read = (file: string | undefined): Results => {
  if (file === undefined) return fail("Give a results file.");
  return readResults(readFileSync(file, "utf8"));
};

const describeRun = (results: Results): string => {
  const run = results.run;
  if (run === null) return "(no run record)";
  const library = run.library;
  return [
    `${run.label}${run.dryRun ? " (DRY RUN: simulated numbers)" : ""}, ${run.startedAt}`,
    `Wave ${run.apk.versionName ?? "?"} (${run.apk.versionCode ?? "?"}), commit ${run.apk.commit ?? "unknown"}` +
      `, ${run.perfBuild ? "perf build" : "not a perf build"}, ${run.compilation?.status ?? "?"} (${run.compilation?.reason ?? "?"})`,
    `${run.device.manufacturer ?? ""} ${run.device.model ?? "?"}, Android ${run.device.android ?? "?"} (SDK ${run.device.sdk ?? "?"})` +
      `, ${run.display.refreshRateHz ?? "?"} Hz (motion smoothness ${run.display.refreshRateMode ?? "?"}), thermal ${run.thermalStatus ?? "?"}`,
    `Library: ${library.tracks ?? "?"} songs, ${library.playlists ?? "?"} playlists (${library.playlistItems ?? "?"} entries, largest ${
      library.largestPlaylist ?? "?"
    }), ${library.playEvents ?? "?"} plays`,
  ].join("\n");
};

const check = (ok: boolean, line: string): void => console.log(`${ok ? "ok  " : "WARN"} ${line}`);

const mb = (kb: number | undefined): string => (kb === undefined ? "-" : (kb / 1024).toFixed(1));

const median = (numbers: readonly number[]): number | null => {
  const sorted = numbers.toSorted((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

// ---------------------------------------------------------------------------
// ART profiles (#317, docs/performance/317-android-profiles.md)

/** Where Wave's profiles are checked in; withArtProfiles copies them in at prebuild. */
const PROFILES = join(root, "apps", "mobile", "profiles");
const PROFILES_META = "profiles.json";

/** What a change since the profiles were generated can make them miss: native code. */
const NATIVE_PATHS = [
  "apps/mobile/modules/",
  "apps/mobile/plugins/",
  "apps/mobile/app.config.ts",
  "apps/mobile/package.json",
  "pnpm-lock.yaml",
];

const ruleCount = (rules: ProfileRules) => ({
  classes: rules.classes.size,
  methods: rules.methods.size,
});

const readChecked = (name: string): ProfileRules | undefined => {
  const file = join(PROFILES, name);
  return existsSync(file) ? parseProfileText(readFileSync(file, "utf8")).rules : undefined;
};

const profileCommands: Record<string, () => Promise<void>> = {
  generate: async () => {
    if (values.apk === undefined && !values["dry-run"])
      fail("Give the unminified release APK to profile: --apk <file> (see the #317 doc).");
    if (values.apk !== undefined) {
      const apk = readApkProfile(readFileSync(values.apk));
      if (looksMinified(apk))
        fail(
          `${values.apk} was minified by R8: its class names won't match the next build's. ` +
            "Build it with -Pandroid.enableMinifyInReleaseBuilds=false.",
        );
    }
    const device = await pickDevice();
    if (values.apk !== undefined && !values["dry-run"]) await installApk(device.serial, values.apk);
    const iterations = values.iterations === undefined ? 3 : Number(values.iterations);
    const generated = await generateProfiles(device, {
      package: fixture.package,
      tabs: fixture.tabs,
      launchSettleMs: fixture.launchSettleMs,
      settleMs: fixture.settleMs,
      startupLaunches: 3,
      journeyIterations: iterations,
      log: (line) => console.log(line),
    });
    const installed = parsePackage(await device.shell(`dumpsys package ${fixture.package}`));
    // A dry run's profile is made up: it never goes into the app.
    const dir = values["dry-run"] ? join(root, "perf-results", "profiles-dry-run") : PROFILES;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "baseline-prof.txt"), formatProfile(generated.baseline));
    writeFileSync(join(dir, "startup-prof.txt"), formatProfile(generated.startup));
    const meta = {
      generatedAt: new Date().toISOString(),
      dryRun: values["dry-run"],
      commit: values.commit ?? gitCommit(),
      apk: {
        file: values.apk ?? null,
        sha256:
          values.apk === undefined
            ? null
            : createHash("sha256").update(readFileSync(values.apk)).digest("hex"),
        versionName: installed?.versionName ?? null,
        versionCode: installed?.versionCode ?? null,
      },
      device: generated.device,
      startupLaunches: 3,
      journeyIterations: iterations,
      missed: generated.missed,
      rules: { baseline: ruleCount(generated.baseline), startup: ruleCount(generated.startup) },
    };
    writeFileSync(join(dir, PROFILES_META), `${JSON.stringify(meta, null, 2)}\n`);
    console.log(
      `\nWrote ${dir}: baseline ${meta.rules.baseline.classes} classes, ${meta.rules.baseline.methods} methods; ` +
        `startup ${meta.rules.startup.classes} classes, ${meta.rules.startup.methods} methods.`,
    );
    if (generated.missed.length > 0)
      console.log(`WARN the journey missed ${generated.missed.length} target(s): see above.`);
  },

  "check-apk": async () => {
    const file = positionals[2];
    if (file === undefined) return fail("Give the APK: profile check-apk <apk>.");
    const baseline = readChecked("baseline-prof.txt");
    const startup = readChecked("startup-prof.txt");
    const report = checkApkProfile(readApkProfile(readFileSync(file)), {
      ...(values.mapping === undefined ? {} : { mapping: readFileSync(values.mapping, "utf8") }),
      ...(baseline === undefined ? {} : { baseline }),
      ...(startup === undefined ? {} : { startup }),
    });
    const problems: string[] = [];
    check(report.packaged, "assets/dexopt/baseline.prof is in the APK");
    if (!report.packaged) problems.push("no baseline.prof");
    check(report.metadata, "assets/dexopt/baseline.profm (needed on Android 12+) is in the APK");
    if (!report.metadata) problems.push("no baseline.profm");
    console.log(
      `     ${report.classes} classes, ${report.methods.total} methods (${report.methods.hot} hot, ` +
        `${report.methods.startup} startup, ${report.methods.postStartup} post-startup)`,
    );
    console.log(
      `     classes by origin: ${Object.entries(report.classesByGroup)
        .toSorted(([, a], [, b]) => b - a)
        .map(([group, count]) => `${group} ${count}`)
        .join(", ")}`,
    );
    if (report.baseline === null)
      console.log("     no profile checked in under apps/mobile/profiles/");
    else {
      const share =
        report.baseline.expected === 0 ? 1 : report.baseline.shipped / report.baseline.expected;
      const enough = share >= Number(values["min-coverage"]);
      check(
        enough,
        `${report.baseline.shipped} of the ${report.baseline.expected} classes Wave's baseline names (and R8 kept) are in the APK's profile` +
          (values.mapping === undefined ? " (no --mapping: classes R8 renamed go unchecked)" : ""),
      );
      if (!enough) {
        problems.push(`baseline coverage ${(share * 100).toFixed(1)}%`);
        for (const type of report.baseline.missing.slice(0, 10))
          console.log(`       missing ${type}`);
      }
    }
    if (report.startup !== null)
      console.log(
        `     ${report.startup.inPrimaryDex} of the ${report.startup.expected} startup classes are in classes.dex`,
      );
    if (problems.length > 0)
      fail(`\nThe APK's profile isn't what Wave ships: ${problems.join(", ")}.`);
  },

  device: async () => {
    const device = await pickDevice();
    const pkg = fixture.package;
    if (values.install) {
      const { install } = await compileWithBaseline(device, pkg);
      console.log(`profileinstaller: ${install}; compiled speed-profile with the APK's profile`);
    }
    const { compilation, profile } = await readProfileState(device, pkg);
    console.log(
      `compiler filter: ${compilation?.status ?? "?"} (reason ${compilation?.reason ?? "?"})`,
    );
    console.log(
      profile === null
        ? "ART holds no profile for Wave"
        : `ART's profile for Wave: ${profile.classes.size} classes, ${profile.methods.size} methods`,
    );
  },

  status: async () => {
    const file = join(PROFILES, PROFILES_META);
    if (!existsSync(file)) {
      console.log(
        "No profile generated yet (apps/mobile/profiles/). See docs/performance/317-android-profiles.md.",
      );
      return;
    }
    const meta = JSON.parse(readFileSync(file, "utf8")) as {
      generatedAt: string;
      commit: string | null;
      rules: Record<string, { classes: number; methods: number }>;
    };
    console.log(`Generated ${meta.generatedAt} from ${meta.commit ?? "an unknown commit"}.`);
    if (meta.commit === null) return;
    const since = execFileSync(
      "git",
      ["log", "--oneline", `${meta.commit}..HEAD`, "--", ...NATIVE_PATHS],
      { cwd: root, encoding: "utf8" },
    ).trim();
    if (since === "") console.log("No native change since: the profiles are current.");
    else
      console.log(
        `Native changes since then (regenerate the profiles, see the #317 doc):\n${since}`,
      );
  },
};

const commands: Record<string, () => Promise<void>> = {
  scenarios: async () => {
    for (const scenario of SCENARIOS)
      console.log(`${scenario.name.padEnd(18)} ${scenario.iterations}x  ${scenario.summary}`);
    console.log(
      `\nall = ${ALL_SCENARIOS.join(", ")}\nvariants: ${VARIANTS.join(", ")} (import runs "import" first)`,
    );
  },

  doctor: async () => {
    const device = await pickDevice();
    const pkg = fixture.package;
    const apk = parsePackage(await device.shell(`dumpsys package ${pkg}`));
    check(
      apk !== null,
      apk === null
        ? `${pkg} isn't installed`
        : `Wave ${apk.versionName} (${apk.versionCode}) installed`,
    );
    const rate = parseRefreshRate(await device.shell("dumpsys display"));
    check(
      rate !== null && rate >= 119,
      `display at ${rate ?? "?"} Hz (set Motion smoothness to Adaptive or High, screen on)`,
    );
    for (const key of [
      "window_animation_scale",
      "transition_animation_scale",
      "animator_duration_scale",
    ]) {
      const scale = (await device.shell(`settings get global ${key}`)).trim();
      check(scale === "1.0" || scale === "1" || scale === "null", `${key} = ${scale}`);
    }
    const stayOn = (await device.shell("settings get global stay_on_while_plugged_in")).trim();
    check(
      stayOn !== "0",
      `stay awake while plugged in = ${stayOn} (adb shell svc power stayon usb)`,
    );
    const thermal = parseThermalStatus(await device.shell("dumpsys thermalservice"));
    check(thermal === null || thermal === 0, `thermal status ${thermal ?? "?"}`);
    const top = await device.shell(
      "dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity'",
    );
    check(true, `in front now: ${top.trim().split("\n")[0] ?? "?"}`);
    check(
      fixture.importLink !== null,
      `fixture importLink ${fixture.importLink ?? "not set (the import variant can't run)"}`,
    );
    console.log(
      "\nWhether the APK is a perf build shows in the run's first line (it waits for the app's first flush).",
    );
  },

  run: async () => {
    const scenarios = values.scenario === "all" ? ALL_SCENARIOS : values.scenario.split(",");
    for (const name of scenarios)
      if (!SCENARIOS.some((scenario) => scenario.name === name))
        fail(`No scenario named ${name}. See: perf.ts scenarios`);
    const variants = values.variant.split(",") as Variant[];
    for (const variant of variants)
      if (!VARIANTS.includes(variant)) fail(`No variant named ${variant}.`);
    const manual: Record<string, string> = {};
    for (const pair of values.meta) {
      const at = pair.indexOf("=");
      if (at < 1) fail(`--meta takes key=value, not ${pair}`);
      manual[pair.slice(0, at)] = pair.slice(at + 1);
    }
    const device = await pickDevice();
    let apkFile: { path: string; sha256: string } | null = null;
    if (values.apk !== undefined) {
      apkFile = {
        path: values.apk,
        sha256: createHash("sha256").update(readFileSync(values.apk)).digest("hex"),
      };
      if (!values["dry-run"]) await installApk(device.serial, values.apk);
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const out =
      values.out ??
      join(
        root,
        "perf-results",
        `${values.label}-${stamp}${values["dry-run"] ? "-dry-run" : ""}.jsonl`,
      );
    const result = await runPerf(device, {
      package: fixture.package,
      label: values.label,
      scenarios,
      variants,
      ...(values.iterations === undefined ? {} : { iterations: Number(values.iterations) }),
      config: { tabs: fixture.tabs },
      importLink: values["import-link"] ?? fixture.importLink,
      settleMs: fixture.settleMs,
      windowMs: fixture.windowMs,
      launchSettleMs: fixture.launchSettleMs,
      memoryIdleMs: fixture.memoryIdleMs,
      flushTimeoutMs: fixture.flushTimeoutMs,
      commit: values.commit ?? null,
      runnerCommit: gitCommit(),
      apkFile,
      manual,
      compile: values.compile ?? null,
      perfetto: values.perfetto
        ? {
            dir: join(root, "perf-results", "traces"),
            config: readFileSync(join(here, "perfetto.pbtx"), "utf8"),
          }
        : null,
      out,
      dryRun: values["dry-run"],
      log: (line) => console.log(line),
      now: () => new Date(),
    });
    console.log(`\nResults: ${result.out}\n`);
    printSummary(read(result.out));
  },

  summary: async () => printSummary(read(positionals[1])),

  profile: async () => {
    const sub = profileCommands[positionals[1] ?? ""];
    if (sub === undefined) fail("Usage: perf.ts profile generate|check-apk|device|status");
    else await sub();
  },

  compare: async () => {
    const before = read(positionals[1]);
    const after = read(positionals[2]);
    console.log(`Before: ${describeRun(before)}\n\nAfter: ${describeRun(after)}\n`);
    if (before.run !== null && after.run !== null)
      for (const warning of comparability(before.run, after.run))
        console.log(`WARNING: ${warning}`);
    console.log(
      `\n${formatComparison(compareSummaries(summarize(before.steps), summarize(after.steps)))}`,
    );
  },
};

const printSummary = (results: Results): void => {
  console.log(`${describeRun(results)}\n`);
  console.log(formatSummary(summarize(results.steps)));
  const launches = results.steps.flatMap((step) =>
    step.launch?.totalTimeMs == null ? [] : [step.launch.totalTimeMs],
  );
  if (launches.length > 0)
    console.log(
      `\nCold launch (am start -W TotalTime): median ${median(launches)} ms over ${launches.length}`,
    );
  if (results.memory.length > 0) {
    console.log(
      "\n| Scenario | Variant | PSS MB | RSS MB | Java heap MB | Native heap MB | Graphics MB |",
    );
    console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
    for (const memory of results.memory)
      console.log(
        `| ${memory.scenario} | ${memory.variant} | ${mb(memory.totalPssKb)} | ${mb(memory.totalRssKb)} | ${mb(
          memory.javaHeapKb,
        )} | ${mb(memory.nativeHeapKb)} | ${mb(memory.graphicsKb)} |`,
      );
  }
  for (const error of results.errors)
    console.log(`\nNot measured: ${error.scenario} (${error.variant}): ${error.message}`);
};

const action = commands[positionals[0] ?? ""];
if (action === undefined)
  fail(
    `Usage: node scripts/perf/perf.ts scenarios|doctor|run|summary|compare|profile (see the header of ${fileURLToPath(import.meta.url)})`,
  );
else await action();
