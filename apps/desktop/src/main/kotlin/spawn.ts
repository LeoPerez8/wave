/** Starts the JVM as a child process of main, with its stdio as the line protocol. */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { KotlinEvents, KotlinProcess } from "./supervisor.ts";

export interface Command {
  readonly file: string;
  readonly args: readonly string[];
}

export interface JvmPaths {
  /** The jlink runtime (`jvm/runtime`, from `pnpm build:jvm`). */
  readonly runtime: string;
  /** `wave-kotlin.jar`, from `packages/kotlin-shared`. */
  readonly jar: string;
  /** Where the Kotlin keeps its own data, such as the YouTube session. */
  readonly dataDir: string;
  readonly platform: NodeJS.Platform;
  /** A fake Shazam's origin, for a development build's tests; never set when packaged. */
  readonly shazamUrl?: string | undefined;
}

/**
 * The flags measured in the experiment (docs/spec-desktop.md, Kotlin on the JVM): about 60 MB at
 * rest with the heap capped at 128 MB, ready in under 300 ms. Out of memory, it exits and main
 * starts another.
 */
const JVM_FLAGS = [
  "-Xmx128m",
  "-Xss512k",
  "-XX:+UseSerialGC",
  "-XX:TieredStopAtLevel=1",
  "-XX:MinHeapFreeRatio=10",
  "-XX:MaxHeapFreeRatio=20",
  "-XX:+ExitOnOutOfMemoryError",
  "-Xshare:auto",
];

export const jvmCommand = (paths: JvmPaths): Command => ({
  file: join(paths.runtime, "bin", paths.platform === "win32" ? "java.exe" : "java"),
  args: [
    ...JVM_FLAGS,
    "-jar",
    paths.jar,
    "--data",
    paths.dataDir,
    ...(paths.shazamUrl ? ["--shazam-url", paths.shazamUrl] : []),
  ],
});

/**
 * Starts `command` for each JVM the supervisor asks for: lines written go to its stdin, each
 * line of its stdout is an event, and its stderr (logs) goes to `log`. A command that can't
 * start reports an exit like one that crashed.
 */
export const spawnLines =
  (command: Command, log: (text: string) => void = () => undefined) =>
  (events: KotlinEvents): KotlinProcess => {
    const child = spawn(command.file, command.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let alive = true;
    const exited = () => {
      if (!alive) return;
      alive = false;
      events.exit();
    };
    child.once("error", exited);
    // "close", not "exit": the lines it wrote before dying still arrive first.
    child.once("close", exited);
    // A write to a JVM that just died fails here; its exit fails the calls it held.
    child.stdin.on("error", () => undefined);
    child.stdout.setEncoding("utf8");
    createInterface({ input: child.stdout }).on("line", (line) => alive && events.line(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => log(text));
    return {
      write: (line) => {
        if (alive && child.stdin.writable) child.stdin.write(`${line}\n`);
      },
      kill: () => {
        if (alive) child.kill();
      },
    };
  };
