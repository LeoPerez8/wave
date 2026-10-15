/**
 * Hermes compiler flags for the generated app/build.gradle. `withHermesFlags.ts`
 * applies them at prebuild, since the android folder isn't checked in (#187).
 */

const FLAGS = 'hermesFlags = ["-O"]';

/**
 * Keeps Hermes' optimiser (-O) and drops React Native's default
 * -output-source-map: nothing reads the source map, and writing and composing
 * it took over a minute of every release build. The APK is the same either way.
 */
export const compileHermesWithoutSourceMap = (buildGradle: string): string => {
  const lines = buildGradle.split("\n").filter((line) => !line.trim().startsWith("hermesFlags ="));
  const react = lines.findIndex((line) => line.trim() === "react {");
  if (react === -1) {
    throw new Error("app/build.gradle has no `react {` block to set Hermes' flags in");
  }
  return [...lines.slice(0, react + 1), `    ${FLAGS}`, ...lines.slice(react + 1)].join("\n");
};
