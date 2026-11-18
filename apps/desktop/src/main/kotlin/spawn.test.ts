import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { jvmCommand, spawnLines } from "./spawn.ts";
import type { KotlinEvents } from "./supervisor.ts";

test("the JVM runs the bundled JAR from the bundled runtime, with a 128 MB heap cap", () => {
  const command = jvmCommand({
    runtime: join("/app", "jvm", "runtime"),
    jar: join("/app", "jvm", "wave-kotlin.jar"),
    dataDir: join("/data", "kotlin"),
    platform: "linux",
  });
  assert.equal(command.file, join("/app", "jvm", "runtime", "bin", "java"));
  assert.ok(command.args.includes("-Xmx128m"));
  // A JVM out of memory exits, so main restarts it, instead of limping on.
  assert.ok(command.args.includes("-XX:+ExitOnOutOfMemoryError"));
  assert.deepEqual(command.args.slice(-4), [
    "-jar",
    join("/app", "jvm", "wave-kotlin.jar"),
    "--data",
    join("/data", "kotlin"),
  ]);
  const windows = jvmCommand({ runtime: "C:\\Wave\\jvm\\runtime", jar: "x", dataDir: "y", platform: "win32" });
  assert.equal(windows.file, join("C:\\Wave\\jvm\\runtime", "bin", "java.exe"));
});

/** A child that echoes each line back in upper case, as a stand-in for the JVM. */
const echo = [
  "-e",
  `require("node:readline").createInterface({ input: process.stdin }).on("line", (l) => console.log(l.toUpperCase()));`,
];

const recorder = () => {
  const lines: string[] = [];
  let exited!: () => void;
  const exit = new Promise<void>((resolve) => (exited = resolve));
  const events: KotlinEvents = { line: (text) => lines.push(text), exit: () => exited() };
  return { lines, exit, events };
};

test("lines go to the child's stdin and come back one by one from its stdout", async () => {
  const seen = recorder();
  const child = spawnLines({ file: process.execPath, args: echo })(seen.events);
  child.write('{"id":1}');
  child.write("second");
  while (seen.lines.length < 2) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(seen.lines, ['{"ID":1}', "SECOND"]);
  child.kill();
  await seen.exit;
});

test("a child that can't start reports an exit, and writing to it does nothing", async () => {
  const seen = recorder();
  const child = spawnLines({ file: join("/nowhere", "java"), args: [] })(seen.events);
  child.write("lost");
  await seen.exit;
  child.write("still lost");
  child.kill();
});
