/**
 * Main's hold on the JVM that runs `packages/kotlin-shared` (docs/spec-desktop.md, Kotlin on the
 * JVM). Calls go to it as JSON lines and wait for their answer; the JVM asks main for what only
 * main can do the same way. A JVM that exits is replaced, and the calls it held fail with the
 * phone's `ERR_UNEXPECTED`, so a crash never reaches the window as anything but a failed call.
 */
import type { HostMethods, KotlinEvent, KotlinMethod, KotlinMethods } from "./protocol.ts";

/** What a spawned JVM reports back. */
export interface KotlinEvents {
  /** One line the JVM wrote to stdout. */
  readonly line: (text: string) => void;
  /** The JVM exited, or never started. */
  readonly exit: () => void;
}

export interface KotlinProcess {
  /** Writes one line, without its newline, to the JVM's stdin. */
  readonly write: (line: string) => void;
  readonly kill: () => void;
}

export interface KotlinSupervisorOptions {
  /** Starts a JVM that reports to `events`. */
  readonly spawn: (events: KotlinEvents) => KotlinProcess;
  /** What the JVM may ask main, such as `poToken`. */
  readonly host?: HostMethods;
  /** Gets what the JVM tells main unasked, such as `ready`. */
  readonly onEvent?: (event: KotlinEvent) => void;
  /** The wait before the `attempt`th restart in a row (from 1). */
  readonly restartDelayMs?: (attempt: number) => number;
}

/** A call the JVM failed, with the code the phone's module would reject it with. */
export class KotlinError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "KotlinError";
    this.code = code;
  }
}

export interface KotlinSupervisor {
  readonly call: <M extends KotlinMethod>(
    method: M,
    params: KotlinMethods[M]["params"],
  ) => Promise<KotlinMethods[M]["result"]>;
  readonly dispose: () => void;
}

interface Waiting {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: KotlinError) => void;
}

const backoff = (attempt: number) => Math.min(250 * 2 ** (attempt - 1), 10_000);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const superviseKotlin = (options: KotlinSupervisorOptions): KotlinSupervisor => {
  const restartDelayMs = options.restartDelayMs ?? backoff;
  let current: KotlinProcess | undefined;
  let nextId = 1;
  let disposed = false;
  let failuresInARow = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  const waiting = new Map<number, Waiting>();

  const failAll = (message: string) => {
    for (const [id, call] of waiting) {
      waiting.delete(id);
      call.reject(new KotlinError("ERR_UNEXPECTED", message));
    }
  };

  const onLine = (owner: KotlinProcess) => (text: string) => {
    if (owner !== current) return;
    let line: unknown;
    try {
      line = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(line)) return;
    if (typeof line["event"] === "string") {
      options.onEvent?.(line as KotlinEvent);
      return;
    }
    if (typeof line["method"] === "string") {
      answerJvm(owner, line["id"], line["method"], line["params"]);
      return;
    }
    if (typeof line["id"] !== "number") return;
    const call = waiting.get(line["id"]);
    if (call === undefined) return;
    waiting.delete(line["id"]);
    failuresInARow = 0;
    const error = line["error"];
    if (isRecord(error))
      call.reject(
        new KotlinError(
          typeof error["code"] === "string" ? error["code"] : "ERR_UNEXPECTED",
          typeof error["message"] === "string" ? error["message"] : "The JVM failed the call",
        ),
      );
    else call.resolve(line["result"] ?? null);
  };

  /** Runs the JVM's request `method` and writes its answer back to the JVM that asked. */
  const answerJvm = (owner: KotlinProcess, id: unknown, method: string, params: unknown) => {
    const handler = Object.hasOwn(options.host ?? {}, method) ? options.host?.[method] : undefined;
    const answer: Promise<unknown> =
      handler === undefined
        ? Promise.reject(new KotlinError("ERR_UNKNOWN_METHOD", `Main has no method ${method}`))
        : Promise.resolve().then(() => handler(params ?? {}));
    void answer.then(
      (result) => owner.write(JSON.stringify({ id, result: result ?? null })),
      (error: unknown) => {
        const code = isRecord(error) && typeof error["code"] === "string" ? error["code"] : "ERR_HOST";
        const message = error instanceof Error ? error.message : String(error);
        owner.write(JSON.stringify({ id, error: { code, message } }));
      },
    );
  };

  const onExit = (owner: KotlinProcess) => () => {
    if (owner !== current) return;
    current = undefined;
    failAll("The JVM stopped before answering");
    if (disposed) return;
    failuresInARow += 1;
    // Back with the app's other services, so the next call doesn't wait for a JVM to start.
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      if (!disposed && current === undefined) start();
    }, restartDelayMs(failuresInARow));
  };

  function start(): KotlinProcess {
    let child: KotlinProcess | undefined;
    const events: KotlinEvents = {
      line: (text) => child !== undefined && onLine(child)(text),
      exit: () => child !== undefined && onExit(child)(),
    };
    child = options.spawn(events);
    current = child;
    return child;
  }

  start();

  return {
    call: (method, params) =>
      new Promise((resolve, reject) => {
        if (disposed) {
          reject(new KotlinError("ERR_UNEXPECTED", "The JVM was shut down"));
          return;
        }
        const target = current ?? start();
        const id = nextId++;
        waiting.set(id, { resolve: resolve as (result: unknown) => void, reject });
        target.write(JSON.stringify({ id, method, params }));
      }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (restartTimer !== undefined) clearTimeout(restartTimer);
      failAll("The JVM was shut down");
      current?.kill();
      current = undefined;
    },
  };
};
