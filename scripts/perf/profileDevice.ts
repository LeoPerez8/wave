// ART profiles on the phone (#317): capturing Wave's own while it runs a journey, putting the
// APK's shipped profile in place the way a fresh install gets it, and reading what ART holds.
// Everything goes through the runner's `Device`, so the simulated phone covers it too.
//
// Capturing follows what Jetpack Macrobenchmark's BaselineProfileRule does on a phone without
// root: clear the profile, tell profileinstaller not to write the APK's own, run the journey,
// have the app save its profile (SIGUSR1, through profileinstaller's receiver), then
// `pm dump-profiles --dump-classes-and-methods` (Android 13+) writes it out as text.
import { mergeProfiles, parseProfileText, type ProfileRules } from "./artProfile.ts";
import { findNode, parseAmStart, parseCompilation, parseGetprop, type Target } from "./device.ts";
import type { Device } from "./runner.ts";

const RECEIVER = "androidx.profileinstaller.ProfileInstallReceiver";

/** ProfileInstaller's result codes (androidx.profileinstaller 1.3-1.4), by the name it gives them. */
const RESULTS: Readonly<Record<number, string>> = {
  0: "NO_RECEIVER",
  1: "INSTALL_SUCCESS",
  2: "ALREADY_INSTALLED",
  3: "UNSUPPORTED_ART_VERSION",
  4: "NOT_WRITABLE",
  5: "DESIRED_FORMAT_UNSUPPORTED",
  6: "BASELINE_PROFILE_NOT_FOUND",
  7: "IO_EXCEPTION",
  8: "PARSE_EXCEPTION",
  9: "META_FILE_REQUIRED_BUT_NOT_FOUND",
  10: "INSTALL_SKIP_FILE_SUCCESS",
  11: "DELETE_SKIP_FILE_SUCCESS",
  12: "SAVE_PROFILE_SIGNALLED",
  13: "SAVE_PROFILE_SKIPPED",
};

/** Time the app gets to write its profile after being told to. */
const SAVE_MS = 2_000;
const UI_DUMP = "/sdcard/wave-profile-ui.xml";

type ProfileAction = "INSTALL_PROFILE" | "SAVE_PROFILE" | "SKIP_FILE";

/** Sends profileinstaller's receiver in the app [action]; resolves the result's name. */
const profileInstaller = async (
  device: Device,
  pkg: string,
  action: ProfileAction,
  skipFile?: "WRITE_SKIP_FILE" | "DELETE_SKIP_FILE",
): Promise<string> => {
  const extra = skipFile === undefined ? "" : ` -e EXTRA_SKIP_FILE_OPERATION ${skipFile}`;
  const output = await device.shell(
    `am broadcast -a androidx.profileinstaller.action.${action}${extra} --include-stopped-packages ${pkg}/${RECEIVER}`,
  );
  const code = /Broadcast completed: result=(-?\d+)/.exec(output)?.[1];
  if (code === undefined) return "NO_RESULT";
  return RESULTS[Number(code)] ?? `RESULT_${code}`;
};

/** The profile ART has saved for [pkg], as text; empty when it has none. */
const dumpProfile = async (device: Device, pkg: string): Promise<ProfileRules> => {
  await device.shell(`pm dump-profiles --dump-classes-and-methods ${pkg}`);
  const { rules } = parseProfileText(
    await device.shell(`cat /data/misc/profman/${pkg}-primary.prof.txt`),
  );
  return rules;
};

const isEmpty = (rules: ProfileRules): boolean =>
  rules.classes.size === 0 && rules.methods.size === 0;

/** The app's compiler filter and the profile ART holds for it now. */
export const readProfileState = async (
  device: Device,
  pkg: string,
): Promise<{
  compilation: { status: string; reason: string | null } | null;
  profile: ProfileRules | null;
}> => {
  const compilation = parseCompilation(await device.shell(`dumpsys package ${pkg}`));
  const profile = await dumpProfile(device, pkg);
  return { compilation, profile: isEmpty(profile) ? null : profile };
};

/**
 * Puts [pkg] in the state a sideloaded install reaches once profileinstaller has written the
 * APK's profile and the phone's idle compile has run: a cleared profile, then only the shipped
 * one, compiled `speed-profile`. Before and after runs both use it, so they compare the
 * shipped profiles and nothing the phone learned since.
 */
export const compileWithBaseline = async (
  device: Device,
  pkg: string,
): Promise<{ install: string }> => {
  await device.shell(`am force-stop ${pkg}`);
  await device.shell(`cmd package compile --reset ${pkg}`);
  const install = await profileInstaller(device, pkg, "INSTALL_PROFILE");
  if (install !== "INSTALL_SUCCESS")
    throw new Error(`profileinstaller didn't install the APK's profile: ${install}.`);
  await device.shell(`am force-stop ${pkg}`);
  await device.shell(`cmd package compile -m speed-profile -f ${pkg}`);
  return { install };
};

// ---------------------------------------------------------------------------
// Capturing

export interface GenerateOptions {
  readonly package: string;
  /** The tab bar's tabs, Home first (the fixture's). */
  readonly tabs: readonly string[];
  /** Time a launch gets to finish its startup work. */
  readonly launchSettleMs: number;
  /** Time each journey step gets before the next. */
  readonly settleMs: number;
  /** Cold launches the startup profile is taken from. */
  readonly startupLaunches: number;
  /** Times the whole journey runs, each from a cold launch. */
  readonly journeyIterations: number;
  readonly log: (line: string) => void;
}

export interface GeneratedProfiles {
  /** What the launches ran: R8 lays these classes out first, in classes.dex. */
  readonly startup: ProfileRules;
  /** What the launches and the journey ran: ART compiles these ahead of time. */
  readonly baseline: ProfileRules;
  /** Journey targets that weren't on screen, as JSON. */
  readonly missed: readonly string[];
  readonly device: {
    readonly model: string | null;
    readonly android: string | null;
    readonly sdk: number;
    readonly fingerprint: string | null;
  };
}

type JourneyStep =
  | { readonly tap: Target }
  | { readonly swipe: "up" | "down" }
  | { readonly back: true };

/**
 * The owner's normal browsing (docs/spec.md): every tab, a Track list scrolled, Now Playing
 * and its Queue, Settings and Search. The same labels the runner's scenarios tap.
 */
const journey = (tabs: readonly string[]): readonly JourneyStep[] => [
  ...tabs.slice(1).map((tab) => ({ tap: { desc: tab } })),
  { tap: { desc: tabs[0] ?? "Home" } },
  { tap: { desc: "Library" } },
  { tap: { text: "Songs" } },
  { swipe: "up" },
  { swipe: "up" },
  { swipe: "down" },
  { tap: { desc: "Back" } },
  { tap: { descPrefix: "Now playing:" } },
  { tap: { desc: "Queue" } },
  { swipe: "up" },
  { tap: { desc: "Queue" } },
  { tap: { desc: "Close Now Playing" } },
  { tap: { desc: tabs[0] ?? "Home" } },
  { tap: { desc: "Settings" } },
  { tap: { desc: "Back" } },
  { tap: { desc: "Search" } },
  { back: true },
];

export const generateProfiles = async (
  device: Device,
  options: GenerateOptions,
): Promise<GeneratedProfiles> => {
  const { package: pkg, log } = options;
  const shell = (command: string): Promise<string> => device.shell(command);
  const props = parseGetprop(await shell("getprop"));
  const sdk = Number(props["ro.build.version.sdk"] ?? "0");
  if (!(sdk >= 33))
    throw new Error(
      `Reading a release app's profile without root needs Android 13 (API 33) or newer; this phone has API ${sdk}.`,
    );
  const size = /Physical size: (\d+)x(\d+)/.exec(await shell("wm size"));
  const width = Number(size?.[1] ?? 1080);
  const height = Number(size?.[2] ?? 2340);
  const missed = new Set<string>();

  const launch = async (): Promise<void> => {
    await shell(`am force-stop ${pkg}`);
    const started = parseAmStart(
      await shell(
        `am start -W -S -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p ${pkg}`,
      ),
    );
    if (started.status !== "ok") throw new Error(`Couldn't launch ${pkg} (${started.status}).`);
    await device.sleep(options.launchSettleMs);
  };

  /** Has the app write what ART recorded, before anything kills it. */
  const save = async (): Promise<void> => {
    const result = await profileInstaller(device, pkg, "SAVE_PROFILE");
    if (result !== "SAVE_PROFILE_SIGNALLED")
      throw new Error(`The app didn't save its profile (${result}).`);
    await device.sleep(SAVE_MS);
  };

  const find = async (target: Target): Promise<{ x: number; y: number } | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const found = findNode(
        await shell(`uiautomator dump ${UI_DUMP} >/dev/null 2>&1; cat ${UI_DUMP}`),
        target,
      );
      if (found !== null) return found;
      await device.sleep(1_000);
    }
    return null;
  };

  const step = async (action: JourneyStep): Promise<void> => {
    if ("tap" in action) {
      const at = await find(action.tap);
      if (at === null) {
        missed.add(JSON.stringify(action.tap));
        return;
      }
      await shell(`input tap ${at.x} ${at.y}`);
    } else if ("swipe" in action) {
      const [from, to] = action.swipe === "up" ? [0.7, 0.3] : [0.3, 0.7];
      const x = Math.round(width / 2);
      await shell(
        `input swipe ${x} ${Math.round(height * from)} ${x} ${Math.round(height * to)} 250`,
      );
    } else await shell("input keyevent 4");
    await device.sleep(options.settleMs);
  };

  await shell("input keyevent KEYCODE_WAKEUP");
  // The APK's own profile (AndroidX's) would land in the capture: tell profileinstaller to
  // skip it, then clear what ART has.
  const skip = await profileInstaller(device, pkg, "SKIP_FILE", "WRITE_SKIP_FILE");
  if (skip !== "INSTALL_SKIP_FILE_SUCCESS")
    throw new Error(`profileinstaller didn't take the skip file (${skip}). Is it in the APK?`);
  await shell(`am force-stop ${pkg}`);
  await shell(`cmd package compile --reset ${pkg}`);

  for (let i = 1; i <= options.startupLaunches; i++) {
    log(`startup: launch ${i}/${options.startupLaunches}`);
    await launch();
    await save();
  }
  const startup = await dumpProfile(device, pkg);
  if (isEmpty(startup)) throw new Error("ART gave back an empty profile after the launches.");

  for (let i = 1; i <= options.journeyIterations; i++) {
    log(`journey: ${i}/${options.journeyIterations}`);
    await launch();
    for (const action of journey(options.tabs)) await step(action);
    await save();
  }
  const captured = await dumpProfile(device, pkg);
  await profileInstaller(device, pkg, "SKIP_FILE", "DELETE_SKIP_FILE");
  await shell(`am force-stop ${pkg}`);
  for (const target of missed) log(`not found on screen: ${target}`);
  return {
    startup,
    // Captured after the launches without a reset, so it has them already; merged anyway,
    // since AGP reads startup-prof.txt for R8's layout only, not into the baseline.
    baseline: mergeProfiles(captured, startup),
    missed: [...missed],
    device: {
      model: props["ro.product.model"] ?? null,
      android: props["ro.build.version.release"] ?? null,
      sdk,
      fingerprint: props["ro.build.fingerprint"] ?? null,
    },
  };
};
