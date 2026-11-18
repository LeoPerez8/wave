/**
 * Builds what main runs the shared Kotlin with (docs/spec-desktop.md, Kotlin on the JVM):
 * `jvm/wave-kotlin.jar` from `packages/kotlin-shared`, and `jvm/runtime`, a Java runtime trimmed
 * by jlink to the modules that JAR needs. Uses the JDK in `JAVA_HOME` (21 or later), which must
 * match the platform the runtime ships for.
 */
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * The modules jdeps finds in the JAR, less two Wave never reaches: java.desktop (jaudiotagger's
 * artwork and AWT paths, off because the reader runs in its Android mode) and java.instrument
 * (the coroutines debug agent). jdk.crypto.ec gives TLS its elliptic curves.
 */
const MODULES = [
  "java.base",
  "java.logging",
  "java.management",
  "jdk.unsupported",
  "jdk.crypto.ec",
];
const LEFT_OUT = ["java.desktop", "java.instrument"];

const windows = process.platform === "win32";
const desktop = join(import.meta.dirname, "..");
const kotlin = join(desktop, "..", "..", "packages", "kotlin-shared");
const out = join(desktop, "jvm");
const runtime = join(out, "runtime");
const javaHome = process.env["JAVA_HOME"];
const jdkTool = (name: string) =>
  javaHome === undefined || javaHome === "" ? name : join(javaHome, "bin", name);

const run = (file: string, args: readonly string[], options: SpawnSyncOptions = {}) => {
  const done = spawnSync(file, args, { stdio: "inherit", ...options });
  if (done.status !== 0) {
    console.error(`${file} failed`);
    process.exit(done.status ?? 1);
  }
  return done;
};

const gradle = [":stdio:fatJar", "--console=plain"];
// A .bat runs only through the shell, given as one command line.
if (windows)
  run(`"${join(kotlin, "gradlew.bat")}" ${gradle.join(" ")}`, [], { cwd: kotlin, shell: true });
else run("./gradlew", gradle, { cwd: kotlin });
mkdirSync(out, { recursive: true });
const jar = join(out, "wave-kotlin.jar");
copyFileSync(join(kotlin, "stdio", "build", "libs", "wave-kotlin.jar"), jar);

const needed = run(
  jdkTool("jdeps"),
  ["--multi-release", "21", "--ignore-missing-deps", "--print-module-deps", jar],
  { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" },
)
  .stdout.toString()
  .trim()
  .split(",");
const missing = needed.filter((name) => !MODULES.includes(name) && !LEFT_OUT.includes(name));
if (missing.length > 0) {
  console.error(`The JAR now needs ${missing.join(", ")}: add it to MODULES in this script.`);
  process.exit(1);
}

rmSync(runtime, { recursive: true, force: true });
run(jdkTool("jlink"), [
  "--add-modules",
  MODULES.join(","),
  "--strip-debug",
  "--no-man-pages",
  "--no-header-files",
  // Left uncompressed: the installer compresses it far better than jlink does.
  "--compress=zip-0",
  "--generate-cds-archive",
  "--output",
  runtime,
]);
// The class-data archive for heaps over 32 GB; with -Xmx128m the JVM never maps it.
const nocoops = join(runtime, windows ? "bin" : "lib", "server", "classes_nocoops.jsa");
if (existsSync(nocoops)) {
  // jlink writes it read-only, which stops Windows deleting it.
  chmodSync(nocoops, 0o644);
  rmSync(nocoops);
}
console.log(`Built ${jar} and ${runtime}`);
