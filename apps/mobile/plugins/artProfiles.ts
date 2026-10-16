/**
 * Wave's ART profiles (#317) in the generated Android project. `withArtProfiles.ts` applies
 * these at prebuild, since the android folder isn't checked in.
 *
 * `apps/mobile/profiles/` holds the profiles `perf.ts profile generate` captured on the phone
 * (docs/performance/317-android-profiles.md). AGP reads `src/main/baselineProfiles/`: every
 * file there but `startup-prof.txt` joins the baseline profile packaged in
 * `assets/dexopt/baseline.prof`, which ART compiles ahead of time; `startup-prof.txt` tells
 * R8 which classes to lay out first, in classes.dex.
 */

/**
 * profileinstaller writes the APK's profile on a sideloaded install, where no store
 * delivers one. The 1.3.1 Wave gets through its libraries refuses every phone newer than
 * Android 14 (API 34) with UNSUPPORTED_ART_VERSION; 1.4.1 has no ceiling.
 */
const PROFILE_INSTALLER = 'implementation("androidx.profileinstaller:profileinstaller:1.4.1")';

/** Adds profileinstaller to the app's dependencies. Replaces the line from an earlier run. */
export const addProfileInstaller = (buildGradle: string): string => {
  const lines = buildGradle
    .split("\n")
    .filter((line) => !line.includes("androidx.profileinstaller:profileinstaller:"));
  const dependencies = lines.findIndex((line) => line.trim() === "dependencies {");
  if (dependencies === -1)
    throw new Error("app/build.gradle has no `dependencies {` block to add profileinstaller to");
  return [
    ...lines.slice(0, dependencies + 1),
    `    ${PROFILE_INSTALLER}`,
    ...lines.slice(dependencies + 1),
  ].join("\n");
};

const DIR = "app/src/main/baselineProfiles";
const NAMES = ["baseline-prof.txt", "startup-prof.txt"] as const;

const RULE = /^(?:[HSP]*L[^;\s]+;->[^(\s]+\([^)\s]*\)\S+|L[^;\s]+;)$/;

/** The rules of a profile file, failing on any line that is neither a rule, `#` nor blank. */
const rules = (name: string, contents: string): Set<string> => {
  const found = new Set<string>();
  contents.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    if (!RULE.test(line))
      throw new Error(`profiles/${name} line ${index + 1} isn't an ART profile rule: ${line}`);
    // A method's descriptor without its flags: the baseline may flag it more widely.
    found.add(line.replace(/^[HSP]+/, ""));
  });
  return found;
};

/**
 * The files to write into the generated project, from the checked-in profiles [read] returns
 * (null when a file isn't there). None before a profile is generated.
 */
export const artProfileFiles = (
  read: (name: string) => string | null,
): { path: string; contents: string }[] => {
  const [baselineName, startupName] = NAMES;
  const baseline = read(baselineName);
  const startup = read(startupName);
  if (startup !== null) {
    if (baseline === null)
      throw new Error(`profiles/${startupName} needs profiles/${baselineName} next to it`);
    const kept = rules(baselineName, baseline);
    const lacking = [...rules(startupName, startup)].filter((rule) => !kept.has(rule));
    if (lacking.length > 0)
      throw new Error(
        `profiles/${baselineName} lacks ${lacking.length} rule(s) of ${startupName}, e.g. ${lacking[0]}. ` +
          "AGP doesn't add the startup profile to the baseline: regenerate them together.",
      );
  } else if (baseline !== null) rules(baselineName, baseline);
  return NAMES.flatMap((name) => {
    const contents = name === baselineName ? baseline : startup;
    return contents === null ? [] : [{ path: `${DIR}/${name}`, contents }];
  });
};
