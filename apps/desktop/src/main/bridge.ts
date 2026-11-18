/** Main's side of the bridge: one IPC handler per call in the contract. */
import { extname, isAbsolute, normalize } from "node:path";
import { Database } from "@wave/client";
import { libraryCounts } from "@wave/client/db/counts";
import * as Effect from "effect/Effect";
import { BRIDGE_CALLS, type BridgeCall, type BridgeContract } from "../shared/bridge.ts";
import { PLAYABLE_EXTENSIONS } from "../shared/playback.ts";
import { Player } from "./audio/player.ts";
import type { AudioEngineError } from "./audio/supervisor.ts";
import { Kotlin } from "./kotlin/kotlin.ts";
import { DesktopLibrary } from "./library/library.ts";
import type { Page } from "../shared/bridge.ts";

export type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

interface IpcMainLike {
  readonly handle: (channel: string, handler: IpcHandler) => void;
}

interface Runtime<R> {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
}

/** The services the calls use. */
export type BridgeServices = Database | Player | Kotlin | DesktopLibrary;

const refuse = (call: BridgeCall, why: string) => Effect.fail(new Error(`Refused ${call}: ${why}`));

/** An absolute path to a file the engine plays. */
const songPath = (value: unknown): string | undefined =>
  typeof value === "string" &&
  isAbsolute(value) &&
  PLAYABLE_EXTENSIONS.includes(extname(value).slice(1).toLowerCase())
    ? value
    : undefined;

const playerCall = <A>(
  run: (player: Player["Service"]) => Effect.Effect<A, AudioEngineError>,
): Effect.Effect<A, Error, Player> =>
  Effect.gen(function* () {
    return yield* run(yield* Player);
  }).pipe(
    // Only the message crosses IPC, so the window reads the engine's code from it.
    Effect.mapError((error) => new Error(`[${error.code}] ${error.message}`)),
  );

const kotlinCall = <A>(
  run: (
    kotlin: Kotlin["Service"],
  ) => Effect.Effect<A, { readonly code: string; readonly message: string }>,
): Effect.Effect<A, Error, Kotlin> =>
  Effect.gen(function* () {
    return yield* run(yield* Kotlin);
  }).pipe(Effect.mapError((error) => new Error(`[${error.code}] ${error.message}`)));

const libraryCall = <A>(run: (library: DesktopLibrary["Service"]) => A | Promise<A>) =>
  Effect.gen(function* () {
    const library = yield* DesktopLibrary;
    return yield* Effect.tryPromise({ try: async () => run(library), catch: (error) => error });
  });

const pageCall = <T>(
  call: BridgeCall,
  args: readonly unknown[],
  run: (library: DesktopLibrary["Service"], offset: number, limit: number) => Page<T>,
) => {
  const [offset, limit] = args;
  return typeof offset === "number" &&
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    typeof limit === "number" &&
    Number.isSafeInteger(limit) &&
    limit >= 1 &&
    limit <= 200
    ? libraryCall((library) => run(library, offset, limit))
    : refuse(call, "invalid page");
};

/** What each call does; `args` come from the window and are checked here before use. */
type Handlers = {
  readonly [C in BridgeCall]: (
    args: readonly unknown[],
  ) => Effect.Effect<BridgeContract[C]["result"], unknown, BridgeServices>;
};

const createHandlers = (): Handlers => {
  let loadedPath: string | undefined;
  const checkAvailable = (path: string | undefined) =>
    Effect.gen(function* () {
      const library = yield* DesktopLibrary;
      if (path !== undefined && library.unavailable(path))
        return yield* Effect.fail(new Error("[folder-unavailable] Drive is not connected"));
    });
  return {
    "library.counts": () =>
      Effect.gen(function* () {
        return libraryCounts(yield* Database);
      }),
    "library.scanStatus": () => libraryCall((library) => library.status()),
    "library.refresh": () =>
      libraryCall((library) => {
        void library.refresh();
      }),
    "library.songs": (args) =>
      pageCall("library.songs", args, (library, offset, limit) => library.songs(offset, limit)),
    "library.roots": (args) =>
      pageCall("library.roots", args, (library, offset, limit) => library.folders(offset, limit)),
    "library.exclusions": (args) =>
      pageCall("library.exclusions", args, (library, offset, limit) =>
        library.exclusions(offset, limit),
      ),
    "library.addRoot": () => libraryCall((library) => library.pickRoot()),
    "library.exclude": () => libraryCall((library) => library.pickExclusion()),
    "library.removeRoot": ([path]) =>
      typeof path === "string" && isAbsolute(path)
        ? libraryCall((library) => library.removeRoot(path))
        : refuse("library.removeRoot", "invalid folder"),
    "library.include": ([path]) =>
      typeof path === "string" && isAbsolute(path)
        ? libraryCall((library) => library.include(path))
        : refuse("library.include", "invalid folder"),
    "player.load": ([path]) => {
      const song = songPath(path);
      return song === undefined
        ? refuse("player.load", "not an absolute path to an audio file")
        : Effect.gen(function* () {
            const path = yield* libraryCall((library) => library.resolvePath(song));
            yield* checkAvailable(path);
            const status = yield* playerCall((player) => player.load(normalize(path)));
            loadedPath = path;
            return status;
          });
    },
    "player.play": () =>
      Effect.gen(function* () {
        yield* checkAvailable(loadedPath);
        return yield* playerCall((player) => player.play());
      }),
    "player.pause": () => playerCall((player) => player.pause()),
    "player.seek": ([positionMs]) =>
      typeof positionMs === "number" && Number.isFinite(positionMs) && positionMs >= 0
        ? playerCall((player) => player.seek(positionMs))
        : refuse("player.seek", "not a time in milliseconds"),
    "player.status": () => playerCall((player) => player.status()),
    "tags.read": ([path]) => {
      const song = songPath(path);
      return song === undefined
        ? refuse("tags.read", "not an absolute path to an audio file")
        : kotlinCall((kotlin) => kotlin.readTags(song));
    },
  };
};

/** Registers every call, answering only frames `isTrusted` accepts. */
export const registerBridge = (
  ipcMain: IpcMainLike,
  runtime: Runtime<BridgeServices>,
  isTrusted: (event: unknown) => boolean,
): void => {
  const handlers = createHandlers();
  for (const call of BRIDGE_CALLS) {
    const handler: (args: readonly unknown[]) => Effect.Effect<unknown, unknown, BridgeServices> =
      handlers[call];
    ipcMain.handle(call, async (event, ...args) => {
      if (!isTrusted(event)) throw new Error(`Refused ${call} from an untrusted frame`);
      return runtime.runPromise(handler(args));
    });
  }
};
