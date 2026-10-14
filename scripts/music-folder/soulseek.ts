/**
 * Soulseek for replace.ts: Wave's own Android client (SoulseekClient.kt and its
 * MP3 check, unchanged) compiled for the PC's JVM, behind the small bridge in
 * soulseek/PcSoulseek.kt. The Kotlin compiler comes from Gradle's cache, where
 * the Android build left it; nothing is downloaded.
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { SoulseekCandidate } from "../../packages/core/src/index.ts";
import type { Peers } from "./replace-song.ts";

const here = dirname(fileURLToPath(import.meta.url));
const appClient = join(
  here,
  "../../apps/mobile/modules/wave-native/android/src/main/java/expo/modules/wavenative/soulseek",
);
/** The app's client files the bridge compiles with; the Android-only ones are left out. */
const sources = [
  join(appClient, "SoulseekClient.kt"),
  join(appClient, "SoulseekWire.kt"),
  join(appClient, "Mp3Validation.kt"),
  join(appClient, "SoulseekCandidate.kt"),
  join(appClient, "SoulseekFailure.kt"),
  join(here, "soulseek", "PcSoulseek.kt"),
];

export interface Toolchain {
  readonly java: string;
  readonly compiler: readonly string[];
  readonly stdlib: string;
}

const versionOrder = (a: string, b: string): number => {
  const x = a.split(/[.-]/).map(Number);
  const y = b.split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0 && Number.isFinite(diff)) return diff;
  }
  return 0;
};

/** The JDK and the Kotlin compiler's jars, or why they can't be found. */
export const findToolchain = (env: NodeJS.ProcessEnv = process.env): Toolchain | string => {
  const exe = process.platform === "win32" ? "java.exe" : "java";
  const java = env.JAVA_HOME ? join(env.JAVA_HOME, "bin", exe) : "java";
  const javaVersion = spawnSync(java, ["-version"], { encoding: "utf8" });
  if (javaVersion.status !== 0)
    return `no Java at ${java}: set JAVA_HOME to a JDK 17 or newer (C:\\tools\\jdk-17.0.20.1+1 on the PC)`;
  const cache = join(
    env.GRADLE_USER_HOME ?? join(homedir(), ".gradle"),
    "caches",
    "modules-2",
    "files-2.1",
  );
  const versions = (group: string, artifact: string): string[] => {
    const folder = join(cache, group, artifact);
    return existsSync(folder) ? readdirSync(folder).toSorted(versionOrder).toReversed() : [];
  };
  const jar = (group: string, artifact: string, version: string | undefined): string | null => {
    if (version === undefined) return null;
    const folder = join(cache, group, artifact, version);
    if (!existsSync(folder)) return null;
    for (const hash of readdirSync(folder)) {
      const path = join(folder, hash, `${artifact}-${version}.jar`);
      if (existsSync(path)) return path;
    }
    return null;
  };
  const kotlin = "org.jetbrains.kotlin";
  for (const version of versions(kotlin, "kotlin-compiler-embeddable")) {
    const needed = [
      jar(kotlin, "kotlin-compiler-embeddable", version),
      jar(kotlin, "kotlin-stdlib", version),
      jar(kotlin, "kotlin-script-runtime", version),
      jar(kotlin, "kotlin-daemon-embeddable", version),
      jar(kotlin, "kotlin-reflect", versions(kotlin, "kotlin-reflect")[0]),
      jar(
        "org.jetbrains.kotlinx",
        "kotlinx-coroutines-core-jvm",
        versions("org.jetbrains.kotlinx", "kotlinx-coroutines-core-jvm")[0],
      ),
      jar("org.jetbrains", "annotations", versions("org.jetbrains", "annotations")[0]),
    ];
    if (needed.every((path) => path !== null))
      return { java, compiler: needed as string[], stdlib: needed[1] as string };
  }
  return `no Kotlin compiler in ${cache}: build the Android app once (see docs) so Gradle caches it`;
};

/** Compiles the bridge once per version of its sources; returns its classpath. */
export const buildBridge = (toolchain: Toolchain): string => {
  const hash = createHash("sha256");
  for (const source of [...sources, ...toolchain.compiler])
    hash.update(source).update(readFileSync(source));
  const out = join(tmpdir(), "wave-pc-soulseek", hash.digest("hex").slice(0, 16));
  const done = join(out, "built");
  if (!existsSync(done)) {
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const compiled = spawnSync(
      toolchain.java,
      [
        "-cp",
        toolchain.compiler.join(delimiter),
        "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler",
        "-no-stdlib",
        "-no-reflect",
        "-classpath",
        toolchain.stdlib,
        "-jvm-target",
        "17",
        "-nowarn",
        "-d",
        out,
        ...sources,
      ],
      { encoding: "utf8" },
    );
    if (compiled.status !== 0)
      throw new Error(`the Soulseek bridge didn't compile:\n${compiled.stderr}${compiled.stdout}`);
    writeFileSync(done, "");
  }
  return [out, toolchain.stdlib].join(delimiter);
};

/** How long a download may take: as the app's journal allows (docs/soulseek.md). */
export interface Deadlines {
  /** Until the first byte: the peer's queue, then the start of the transfer. */
  readonly startMs: number;
  /** Without a byte once it started. */
  readonly stallMs: number;
  readonly totalMs: number;
}

export const DEADLINES: Deadlines = { startMs: 5 * 60_000, stallMs: 60_000, totalMs: 20 * 60_000 };

export interface SoulseekSession extends Peers {
  close(): void;
}

type Answer = Record<string, unknown> & { readonly id?: string };

const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");

/**
 * Logs in with [username] and [password] (kept in memory, passed to the JVM in
 * its environment) and returns Soulseek as replace.ts uses it.
 */
export const connectSoulseek = async (options: {
  readonly username: string;
  readonly password: string;
  readonly host?: string;
  readonly port?: number;
  readonly deadlines?: Deadlines;
}): Promise<SoulseekSession> => {
  const toolchain = findToolchain();
  if (typeof toolchain === "string") throw new Error(toolchain);
  const classpath = buildBridge(toolchain);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SOULSEEK_USERNAME: options.username,
    SOULSEEK_PASSWORD: options.password,
  };
  if (options.host !== undefined) env.WAVE_SOULSEEK_HOST = options.host;
  if (options.port !== undefined) env.WAVE_SOULSEEK_PORT = String(options.port);
  const child: ChildProcessWithoutNullStreams = spawn(
    toolchain.java,
    ["-cp", classpath, "wave.pc.PcSoulseekKt"],
    { env, stdio: "pipe" },
  );
  const deadlines = options.deadlines ?? DEADLINES;
  const waiting = new Map<string, (answer: Answer) => void>();
  const stderr: string[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
  const { promise: connected, resolve: ready } = Promise.withResolvers<Answer>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    let answer: Answer;
    try {
      answer = JSON.parse(line) as Answer;
    } catch {
      return;
    }
    if (answer.event === "connected" || answer.id === "connect") ready(answer);
    else if (answer.id !== undefined) waiting.get(answer.id)?.(answer);
  });
  child.on("close", (code) => {
    const gone: Answer = {
      ok: false,
      message: `the Soulseek bridge stopped (${code}): ${stderr.join("").trim().split("\n").at(-1) ?? ""}`,
    };
    ready(gone);
    for (const listener of waiting.values()) listener(gone);
  });
  const hello = await connected;
  if (hello.event !== "connected") {
    child.kill();
    throw new Error(`Soulseek login failed: ${String(hello.message ?? hello.failure)}`);
  }

  let next = 0;
  const send = (fields: readonly (string | number)[]): void => {
    child.stdin.write(`${fields.join("\t")}\n`);
  };

  return {
    search: (query) =>
      new Promise((resolve, reject) => {
        const id = `s${++next}`;
        waiting.set(id, (answer) => {
          waiting.delete(id);
          if (answer.ok === true) resolve(answer.candidates as SoulseekCandidate[]);
          else reject(new Error(String(answer.message)));
        });
        send(["search", id, b64(query)]);
      }),
    download: (peer, part, expectedDurationMs) =>
      new Promise((resolve) => {
        const id = `d${++next}`;
        const startedAt = Date.now();
        let lastByteAt: number | null = null;
        let gaveUp: string | null = null;
        const giveUp = (reason: string): void => {
          if (gaveUp !== null) return;
          gaveUp = reason;
          send(["cancel", id]);
        };
        const timer = setInterval(() => {
          const now = Date.now();
          if (now - startedAt > deadlines.totalMs)
            giveUp(`it took more than ${deadlines.totalMs / 60_000} minutes`);
          else if (lastByteAt === null && now - startedAt > deadlines.startMs)
            giveUp(`the peer didn't start sending within ${deadlines.startMs / 60_000} minutes`);
          else if (lastByteAt !== null && now - lastByteAt > deadlines.stallMs)
            giveUp(`the peer stopped sending for ${deadlines.stallMs / 1000} seconds`);
        }, 1000);
        waiting.set(id, (answer) => {
          if (answer.event === "progress") {
            lastByteAt = Date.now();
            return;
          }
          if (answer.event === "queued") return;
          clearInterval(timer);
          waiting.delete(id);
          if (answer.ok === true) resolve({ ok: true });
          else resolve({ ok: false, reason: gaveUp ?? String(answer.message) });
        });
        send([
          "download",
          id,
          b64(peer.username),
          b64(peer.filename),
          peer.bytes,
          Math.round(expectedDurationMs),
          b64(part),
        ]);
      }),
    close: () => {
      child.stdin.end();
      setTimeout(() => child.kill(), 2000).unref();
    },
  };
};
