// Plays the scenarios on a phone through adb and writes each measurement to the results
// file as it is taken (docs/performance/README.md, "Results file"). Everything the
// runner asks of the phone goes through `Device`, so a simulated phone (fakeDevice.ts)
// runs the same code for a dry run.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  GLASS_PROBE_EXTRA,
  PERF_FLUSH_QUIET_MS,
  parsePerfLog,
  type GlassProbe,
  type PerfFlush,
} from "../../packages/core/src/index.ts";
import {
  findNode,
  parseAmStart,
  parseCompilation,
  parseDensity,
  parseGetprop,
  parseGfxinfo,
  parseMeminfo,
  parsePackage,
  parseRefreshRate,
  parseThermalStatus,
  parseWmSize,
  type AmStart,
  type Target,
} from "./device.ts";
import { compileWithBaseline, readProfileState } from "./profileDevice.ts";
import { stepMetrics, type StepRecord } from "./metrics.ts";
import {
  findScenario,
  type Action,
  type Scenario,
  type ScenarioConfig,
  type Step,
  type Variant,
} from "./scenarios.ts";

/** The phone, as the runner reaches it. */
export interface Device {
  readonly serial: string;
  /** Runs [command] in the phone's shell, with [input] on its stdin; resolves its stdout. */
  shell(command: string, input?: string): Promise<string>;
  pull(remote: string, local: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface RunOptions {
  readonly package: string;
  readonly label: string;
  readonly scenarios: readonly string[];
  readonly variants: readonly Variant[];
  /** Overrides every scenario's iteration count. */
  readonly iterations?: number;
  readonly config: ScenarioConfig;
  readonly importLink: string | null;
  /** Quiet time before each measured window, so it starts from a still screen. */
  readonly settleMs: number;
  /** How long a measured window stays open, unless its step says otherwise. */
  readonly windowMs: number;
  /** Time a fresh launch gets to finish its startup work before a scenario starts. */
  readonly launchSettleMs: number;
  /** Idle time before memory is read at the end of a scenario. */
  readonly memoryIdleMs: number;
  /** How much longer than the app's quiet time to wait for its flush. */
  readonly flushTimeoutMs: number;
  /** The APK's commit, when the build doesn't say (a perf build reports its own). */
  readonly commit: string | null;
  /** The repo's commit the runner itself ran from. */
  readonly runnerCommit: string | null;
  /** The APK file installed for this run (`--apk`), with its SHA-256. */
  readonly apkFile: { readonly path: string; readonly sha256: string } | null;
  /** Values recorded as given (`--meta key=value`): Library size on a non-perf build, notes. */
  readonly manual: Readonly<Record<string, string>>;
  /**
   * Puts this ART compiler filter on the APK before running (`cmd package compile -m`), or,
   * for `baseline`, compiles it with only the profile the APK ships (#317).
   */
  readonly compile: string | null;
  /**
   * Launches Wave with this glass probe (#316), so its glass drops the layers the
   * probe names. Needs a perf build, which reports the probe it applied.
   */
  readonly glass: GlassProbe | null;
  /** Records a Perfetto trace of each scenario into this folder. */
  readonly perfetto: { readonly dir: string; readonly config: string } | null;
  readonly out: string;
  readonly dryRun: boolean;
  readonly log: (line: string) => void;
  /** The wall clock, for the run's id and timestamps. */
  readonly now: () => Date;
}

/**
 * The measured iterations after which memory is read, [samples] of them spread
 * evenly from 0 (before the first) to [iterations] (after the last). Fewer when
 * there are fewer iterations than samples.
 */
const memorySampleIterations = (samples: number | undefined, iterations: number): Set<number> =>
  samples === undefined || samples < 2
    ? new Set([iterations])
    : new Set(
        Array.from({ length: samples }, (_, k) => Math.round((k * iterations) / (samples - 1))),
      );

/** Thrown when a scenario can't go on; the runner records it and moves to the next. */
class ScenarioError extends Error {}

const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** The perf log's lines, message only. console.log reaches logcat as ReactNativeJS. */
const LOGCAT = "logcat -d -v raw -s ReactNativeJS:V";
const UI_DUMP = "/sdcard/wave-perf-ui.xml";
const POLL_MS = 500;

const tapCommand = ({ x, y }: { x: number; y: number }): string => `input tap ${x} ${y}`;

const ms = (value: number | null): string => (value === null ? "-" : `${value} ms`);

const touches = (action: Action): boolean =>
  action.kind === "tap" ||
  action.kind === "taps" ||
  action.kind === "drag" ||
  action.kind === "fling";

/** A swipe this quick lets the list fling on after the finger lifts. */
const FLING_MS = 120;

/** Several flushes as one: their entries in order, their renders added up, the last meta. */
const merge = (flushes: readonly PerfFlush[]): PerfFlush | null => {
  const last = flushes[flushes.length - 1];
  if (last === undefined) return null;
  const renders: Record<string, number> = {};
  for (const flush of flushes)
    for (const [component, count] of Object.entries(flush.renders))
      renders[component] = (renders[component] ?? 0) + count;
  return {
    tag: flushes.map((flush) => flush.tag).join("+"),
    meta: last.meta,
    entries: flushes.flatMap((flush) => flush.entries),
    renders,
    dropped: flushes.reduce((sum, flush) => sum + flush.dropped, 0),
    complete: flushes.every((flush) => flush.complete),
  };
};

export const runPerf = async (
  device: Device,
  options: RunOptions,
): Promise<{ run: string; out: string }> => {
  const { package: pkg, log } = options;
  const startedAt = options.now();
  const run = `${options.label}-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  mkdirSync(dirname(options.out), { recursive: true });
  const write = (record: object): void =>
    appendFileSync(options.out, `${JSON.stringify(record)}\n`);
  const shell = (command: string, input?: string): Promise<string> => device.shell(command, input);
  const targets = new Map<string, { x: number; y: number }>();
  let screen: { width: number; height: number } | null = null;
  // Until the first launch shows whether the app writes a perf log.
  let perfBuild = false;

  // ---------------------------------------------------------------------------
  // Talking to the app

  /**
   * The app's flushes since logcat was last cleared, once one has arrived (one
   * holding a touch, when [touch]) or the wait ran out. A perf build flushes once
   * it has had no touch for `PERF_FLUSH_QUIET_MS`.
   */
  const collect = async (touch: boolean, waitMs: number): Promise<PerfFlush | null> => {
    let flushes: readonly PerfFlush[] = [];
    for (let waited = 0; waited <= waitMs; waited += POLL_MS) {
      flushes = parsePerfLog(await shell(LOGCAT));
      const done = flushes.some(
        (flush) =>
          flush.complete && (!touch || flush.entries.some((entry) => entry.kind === "touch")),
      );
      if (done) break;
      await device.sleep(POLL_MS);
    }
    return merge(flushes);
  };

  const flushWait = PERF_FLUSH_QUIET_MS + options.flushTimeoutMs;

  /** The glass probe on every launch intent, so a process started anew keeps it. */
  const launchExtras = options.glass === null ? "" : ` --es ${GLASS_PROBE_EXTRA} ${options.glass}`;

  const launch = async (): Promise<AmStart> => {
    await shell(`am force-stop ${pkg}`);
    await device.sleep(options.settleMs);
    await shell("logcat -c");
    const result = parseAmStart(
      await shell(
        `am start -W -S -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p ${pkg}${launchExtras}`,
      ),
    );
    if (result.status !== "ok")
      throw new ScenarioError(`Couldn't launch ${pkg} (${result.status ?? "no status"}).`);
    return result;
  };

  const ensureForeground = async (): Promise<void> => {
    const activities = await shell(
      "dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity'",
    );
    if (!activities.includes(`${pkg}/`))
      throw new ScenarioError(
        `Wave isn't in front (${activities.trim().split("\n")[0] ?? "nothing resumed"}).`,
      );
  };

  const resolve = async (target: Target): Promise<{ x: number; y: number }> => {
    const key = JSON.stringify(target);
    const known = targets.get(key);
    if (known !== undefined) return known;
    for (let attempt = 0; attempt < 3; attempt++) {
      const xml = await shell(`uiautomator dump ${UI_DUMP} >/dev/null 2>&1; cat ${UI_DUMP}`);
      const found = findNode(xml, target);
      if (found !== null) {
        targets.set(key, found);
        return found;
      }
      await device.sleep(1_000);
    }
    throw new ScenarioError(`Couldn't find ${key} on screen.`);
  };

  let pxPerDp: number | null = null;
  /** Pixels per dp on the phone, read once. */
  const density = async (): Promise<number> => {
    if (pxPerDp === null) {
      const dpi = parseDensity(await shell("wm density"));
      if (dpi === null) throw new ScenarioError("Couldn't read the screen density (wm density).");
      pxPerDp = dpi / 160;
    }
    return pxPerDp;
  };

  /** Finds the targets [action] taps before any window opens, so finding them is never measured. */
  const prepare = async (action: Action): Promise<string | null> => {
    switch (action.kind) {
      case "tap":
        return tapCommand(await resolve(action.target));
      case "drag": {
        const centre = await resolve(action.target);
        const scale = await density();
        const at = ({ x, y }: { x: number; y: number }): string =>
          `${Math.round(centre.x + x * scale)} ${Math.round(centre.y + y * scale)}`;
        return `input swipe ${at(action.from)} ${at(action.to)} ${action.durationMs}`;
      }
      case "taps": {
        const commands: string[] = [];
        for (const target of action.targets) commands.push(tapCommand(await resolve(target)));
        return commands.join("; ");
      }
      case "fling": {
        screen ??= parseWmSize(await shell("wm size"));
        if (screen === null) throw new ScenarioError("Couldn't read the screen's size (wm size).");
        const x = Math.round(screen.width / 2);
        const [low, high] = [Math.round(screen.height * 0.7), Math.round(screen.height * 0.3)];
        const [from, to] = action.direction === "up" ? [low, high] : [high, low];
        return `input swipe ${x} ${from} ${x} ${to} ${FLING_MS}`;
      }
      case "back":
        return "input keyevent 4";
      case "share":
        if (options.importLink === null) throw new ScenarioError("The fixture has no importLink.");
        return `am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT ${quote(
          options.importLink,
        )} ${pkg}`;
      case "type":
        return `input text ${quote(action.text)}`;
      case "launch":
      case "resume":
      case "idle":
        return null;
    }
  };

  /** An action outside any window; waits until the app has flushed what it marked. */
  const unmeasured = async (action: Action): Promise<void> => {
    const command = await prepare(action);
    await shell("logcat -c");
    if (command !== null) await shell(command);
    await device.sleep(options.settleMs);
    if (perfBuild && touches(action)) await collect(true, flushWait);
  };

  // ---------------------------------------------------------------------------
  // The run's metadata

  const metadata = async () => {
    const props = parseGetprop(await shell("getprop"));
    const packageText = await shell(`dumpsys package ${pkg}`);
    const apk = parsePackage(packageText);
    if (apk === null) throw new Error(`${pkg} isn't installed on ${device.serial}.`);
    const setting = async (namespace: string, key: string): Promise<string | null> => {
      const value = (await shell(`settings get ${namespace} ${key}`)).trim();
      return value === "" || value === "null" ? null : value;
    };
    // A perf build's first flush, once its startup is quiet, holds the Library's size.
    await launch();
    const app = (await collect(false, options.launchSettleMs + flushWait))?.meta ?? null;
    perfBuild = app !== null;
    if (options.glass !== null) {
      if (!perfBuild)
        throw new Error(
          `--glass ${options.glass} needs a perf build: only a perf build reads the glass probe.`,
        );
      const applied = app?.["glass.probe"];
      if (applied !== options.glass)
        throw new Error(
          `Asked for the glass probe "${options.glass}", but Wave drew its glass as "${String(
            applied ?? "unknown",
          )}". The run wouldn't compare: check that the build has the probe (#316).`,
        );
    }
    const fromApp = (key: string): number | null => {
      const value = app?.[key];
      return typeof value === "number" ? value : null;
    };
    const manualNumber = (key: string): number | null => {
      const value = options.manual[key];
      return value === undefined || Number.isNaN(Number(value)) ? null : Number(value);
    };
    const library = (key: string): number | null =>
      fromApp(`library.${key}`) ?? manualNumber(`library.${key}`);
    return {
      apk: {
        package: pkg,
        ...apk,
        commit: (typeof app?.commit === "string" ? app.commit : null) ?? options.commit,
        file: options.apkFile,
      },
      device: {
        serial: device.serial,
        manufacturer: props["ro.product.manufacturer"] ?? null,
        model: props["ro.product.model"] ?? null,
        android: props["ro.build.version.release"] ?? null,
        sdk:
          props["ro.build.version.sdk"] === undefined
            ? null
            : Number(props["ro.build.version.sdk"]),
        fingerprint: props["ro.build.fingerprint"] ?? null,
      },
      display: {
        refreshRateHz: parseRefreshRate(await shell("dumpsys display")),
        peakRefreshRate: await setting("system", "peak_refresh_rate"),
        minRefreshRate: await setting("system", "min_refresh_rate"),
        // Samsung's Motion smoothness: 0 standard (60 Hz), 1 adaptive, 2 high.
        refreshRateMode: await setting("secure", "refresh_rate_mode"),
      },
      animationScales: {
        window: await setting("global", "window_animation_scale"),
        transition: await setting("global", "transition_animation_scale"),
        animator: await setting("global", "animator_duration_scale"),
      },
      compilation: parseCompilation(packageText),
      perfBuild,
      library: {
        tracks: library("tracks"),
        playlists: library("playlists"),
        playlistItems: library("playlistItems"),
        largestPlaylist: library("largestPlaylist"),
        playEvents: library("playEvents"),
      },
      importLink: options.importLink,
      app,
      thermalStatus: parseThermalStatus(await shell("dumpsys thermalservice")),
      manual: options.manual,
    };
  };

  // ---------------------------------------------------------------------------
  // Measuring

  const measure = async (
    scenario: Scenario,
    variant: Variant,
    step: Step,
    position: { iteration: number; index: number },
    recorded: boolean,
  ): Promise<void> => {
    const tag = `${scenario.name}/${variant}#${position.iteration}.${position.index}`;
    const command = await prepare(step.action);
    let launched: AmStart | null = null;
    if (step.action.kind === "launch") {
      launched = await launch();
    } else if (step.action.kind === "resume") {
      await shell("input keyevent 3");
      await device.sleep(step.action.awayMs ?? options.settleMs);
      await shell("logcat -c");
      launched = parseAmStart(
        await shell(
          `am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p ${pkg}${launchExtras}`,
        ),
      );
      if (launched.status !== "ok")
        throw new ScenarioError(`Couldn't bring ${pkg} back (${launched.status ?? "no status"}).`);
    } else {
      await device.sleep(options.settleMs);
      await shell("logcat -c");
      await shell(`dumpsys gfxinfo ${pkg} reset`);
      if (command !== null) await shell(command);
    }
    await device.sleep(step.windowMs ?? options.windowMs);
    const gfx = parseGfxinfo(await shell(`dumpsys gfxinfo ${pkg} framestats`));
    // Wait for the flush even when not recording, so this step's marks don't reach the next.
    const perf = perfBuild ? await collect(touches(step.action), flushWait) : null;
    if (!recorded) return;
    const metrics = stepMetrics({
      frames: gfx.frames,
      summary: gfx.summary,
      flush: perf,
      expect: step.expect,
      ...(step.anchor === undefined ? {} : { anchor: step.anchor }),
      from: step.from,
      ...(step.phases === undefined ? {} : { phases: step.phases }),
    });
    const meta = perf?.meta ?? {};
    const importRunning = meta["import.running"];
    const prefixed = (prefix: string): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(meta)
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => [key.slice(prefix.length), value]),
      );
    const libraryQueries = prefixed("libraryQueries.");
    const search = prefixed("search.");
    const listeners = prefixed("listeners.");
    const playlistWork = prefixed("playlistWork.");
    const backgroundWork = prefixed("backgroundWork.");
    const record: StepRecord & Record<string, unknown> = {
      type: "step",
      run,
      scenario: scenario.name,
      variant,
      measure: step.measure,
      iteration: position.iteration,
      index: position.index,
      ...metrics,
      flushComplete: perf?.complete ?? null,
      ...(launched === null
        ? {}
        : {
            launch: launched,
            appStartup: Object.fromEntries(
              Object.entries(meta).filter(([key]) => key.startsWith("startup.")),
            ),
          }),
      ...(typeof importRunning === "boolean"
        ? {
            importProgress: {
              running: importRunning,
              done: meta["import.done"] ?? null,
              total: meta["import.total"] ?? null,
              progressShown: meta["import.progressShown"] ?? null,
            },
          }
        : {}),
      // Counters since launch: compare a step's with the one before it for its reads.
      ...(Object.keys(libraryQueries).length > 0 ? { libraryQueries } : {}),
      ...(Object.keys(search).length > 0 ? { search } : {}),
      ...(Object.keys(playlistWork).length > 0 ? { playlistWork } : {}),
      // Background work's slices since launch, how long they waited, and how many a long touch forced (#315).
      ...(Object.keys(backgroundWork).length > 0 ? { backgroundWork } : {}),
      // Subscribers to the playback stores and the sheet when the step's flush was written.
      ...(Object.keys(listeners).length > 0 ? { listeners } : {}),
      // Hermes's used heap in bytes at the step's flush, when it reports it (#318's growth check).
      ...(typeof meta["js.heapUsed"] === "number" ? { jsHeapUsed: meta["js.heapUsed"] } : {}),
    };
    write(record);
    log(
      `  ${tag} ${step.measure}: response ${ms(metrics.responseMs)}, first frame ${ms(
        metrics.firstFrameMs,
      )}, settle ${ms(metrics.settleMs)}, burst ${ms(metrics.burstMs)}, ` +
        `${metrics.frames.deadlineMissed}/${metrics.frames.total} frames late` +
        (launched === null ? "" : `, launch ${ms(launched.totalTimeMs)}`),
    );
  };

  type Trace = { pid: string; remote: string };

  const startTrace = async (name: string): Promise<Trace | null> => {
    if (options.perfetto === null) return null;
    const remote = `/data/misc/perfetto-traces/${name}.pftrace`;
    const pid = (
      await shell(`perfetto --txt -c - -o ${remote} --background`, options.perfetto.config)
    ).trim();
    if (!/^\d+$/.test(pid)) throw new ScenarioError(`Perfetto didn't start: ${pid}`);
    return { pid, remote };
  };

  const stopTrace = async (trace: Trace | null, name: string): Promise<void> => {
    if (trace === null || options.perfetto === null) return;
    await shell(
      `kill -TERM ${trace.pid}; while kill -0 ${trace.pid} 2>/dev/null; do sleep 0.2; done`,
    );
    const local = `${options.perfetto.dir}/${name}.pftrace`;
    mkdirSync(options.perfetto.dir, { recursive: true });
    await device.pull(trace.remote, local);
    await shell(`rm -f ${trace.remote}`);
    write({ type: "trace", run, name, file: local });
    log(`  trace: ${local}`);
  };

  const runScenario = async (scenario: Scenario, variant: Variant): Promise<void> => {
    log(`${scenario.name} (${variant})`);
    const steps = scenario.steps(options.config);
    const launchesItself = steps[0]?.action.kind === "launch";
    const start = async (): Promise<void> => {
      if (launchesItself) return;
      await launch();
      await device.sleep(options.launchSettleMs);
      await ensureForeground();
      for (const action of scenario.setup ?? []) await unmeasured(action);
    };
    const traceName = `${run}-${scenario.name}-${variant}`;
    let trace: Trace | null = null;
    try {
      if (scenario.needsImportLink === true && options.importLink === null)
        throw new ScenarioError(
          "The fixture has no importLink (scripts/perf/fixture.json or --import-link).",
        );
      if (scenario.needsArtist === true && options.config.artist === null)
        throw new ScenarioError(
          "The fixture has no artist (scripts/perf/fixture.json or --artist).",
        );
      if (scenario.needsPlaylist === true && !options.config.playlist?.trim())
        throw new ScenarioError(
          "The fixture has no playlist (scripts/perf/fixture.json or --playlist).",
        );
      if (scenario.coldEachIteration !== true) await start();
      const iterations = options.iterations ?? scenario.iterations;
      const sampled = memorySampleIterations(scenario.memorySamples, iterations);
      const sampleMemory = async (iteration: number | null): Promise<void> => {
        await device.sleep(options.memoryIdleMs);
        write({
          type: "memory",
          run,
          scenario: scenario.name,
          variant,
          ...(iteration === null ? {} : { iteration }),
          ...parseMeminfo(await shell(`dumpsys meminfo ${pkg}`)),
        });
      };
      for (let i = 1; i <= scenario.warmup + iterations; i++) {
        const measured = i - scenario.warmup;
        // The first sample comes before the first measured iteration, after the warm-up.
        if (measured === 1 && sampled.has(0)) await sampleMemory(0);
        const recorded = i > scenario.warmup;
        if (scenario.coldEachIteration === true) await start();
        if (i === scenario.warmup + 1) trace = await startTrace(traceName);
        for (const [index, step] of steps.entries()) {
          await measure(
            scenario,
            variant,
            step,
            { iteration: i - scenario.warmup, index },
            recorded,
          );
        }
        for (const action of scenario.teardown ?? []) await unmeasured(action);
        if (scenario.coldEachIteration !== true) await ensureForeground();
        if (measured > 0 && measured < iterations && sampled.has(measured))
          await sampleMemory(measured);
      }
      await sampleMemory(scenario.memorySamples === undefined ? null : iterations);
    } catch (error) {
      if (!(error instanceof ScenarioError)) throw error;
      write({ type: "error", run, scenario: scenario.name, variant, message: error.message });
      log(`  skipped the rest of ${scenario.name}: ${error.message}`);
    } finally {
      await stopTrace(trace, traceName);
    }
  };

  // ---------------------------------------------------------------------------
  // The run

  await shell("input keyevent KEYCODE_WAKEUP");
  let artProfile: { install: string; classes: number; methods: number } | null = null;
  if (options.compile === "baseline") {
    const { install } = await compileWithBaseline(device, pkg);
    const { profile } = await readProfileState(device, pkg);
    artProfile = {
      install,
      classes: profile?.classes.size ?? 0,
      methods: profile?.methods.size ?? 0,
    };
    log(
      `profileinstaller: ${install}; ART's profile: ${artProfile.classes} classes, ${artProfile.methods} methods`,
    );
  } else if (options.compile !== null)
    await shell(`cmd package compile -m ${options.compile} -f ${pkg}`);
  const meta = await metadata();
  write({
    type: "run",
    schema: 1,
    run,
    label: options.label,
    startedAt: startedAt.toISOString(),
    dryRun: options.dryRun,
    runner: {
      commit: options.runnerCommit,
      node: process.version,
      scenarios: options.scenarios,
      variants: options.variants,
      iterations: options.iterations ?? null,
      settleMs: options.settleMs,
      windowMs: options.windowMs,
      launchSettleMs: options.launchSettleMs,
      compile: options.compile,
      glass: options.glass,
      perfetto: options.perfetto !== null,
      tabs: options.config.tabs,
      artist: options.config.artist,
      playlist: options.config.playlist,
    },
    ...meta,
    ...(options.compile === "baseline" ? { artProfile } : {}),
  });
  log(
    `${meta.device.model ?? "?"} (Android ${meta.device.android ?? "?"}), Wave ${
      meta.apk.versionName ?? "?"
    }, ${meta.display.refreshRateHz ?? "?"} Hz, ${meta.compilation?.status ?? "?"}, ` +
      (meta.perfBuild ? "perf build" : "no perf build: frames, startup and memory only"),
  );

  for (const variant of options.variants) {
    if (variant === "import") {
      const importing = findScenario("import");
      if (importing !== undefined) await runScenario(importing, variant);
    }
    for (const name of options.scenarios.filter((scenario) => scenario !== "import")) {
      const scenario = findScenario(name);
      if (scenario === undefined) throw new Error(`No scenario named ${name}.`);
      await runScenario(scenario, variant);
    }
  }
  write({
    type: "end",
    run,
    finishedAt: options.now().toISOString(),
    thermalStatus: parseThermalStatus(await shell("dumpsys thermalservice")),
  });
  return { run, out: options.out };
};
