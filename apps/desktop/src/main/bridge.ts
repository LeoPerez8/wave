/** Main's side of the bridge: one IPC handler per call in the contract. */
import { extname, isAbsolute, normalize } from "node:path";
import { Database } from "@wave/client";
import { libraryCounts } from "@wave/client/db/counts";
import * as Effect from "effect/Effect";
import { BRIDGE_CALLS, type BridgeCall, type BridgeContract } from "../shared/bridge.ts";
import { PLAYABLE_EXTENSIONS } from "../shared/playback.ts";
import { Playback } from "./playback/playback.ts";
import { validPlaybackCommand, validPlaybackSettings } from "./playback/validation.ts";
import { Player } from "./audio/player.ts";
import type { AudioEngineError } from "./audio/supervisor.ts";
import { Kotlin } from "./kotlin/kotlin.ts";
import { DesktopLibrary } from "./library/library.ts";
import type { Page } from "../shared/bridge.ts";
import { BROWSE_KINDS, type BrowseScope } from "../shared/browse.ts";
import { browseLetter } from "./library/browse.ts";
import { readArtwork } from "./library/artwork.ts";
import { appearance, savePreference } from "./preferences.ts";
import type { Appearance } from "../shared/bridge.ts";

const validScope = (value: unknown): value is BrowseScope => {
  if (typeof value !== "object" || value === null) return false;
  const { kind, id, query } = value as BrowseScope;
  return (
    BROWSE_KINDS.includes(kind) &&
    (!["album", "artist", "playlist", "genre"].includes(kind) ||
      (Number.isSafeInteger(id) && id! > 0)) &&
    (query === undefined || (typeof query === "string" && query.length <= 500))
  );
};

export type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

interface IpcMainLike {
  readonly handle: (channel: string, handler: IpcHandler) => void;
}

interface Runtime<R> {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
}

/** The services the calls use. */
export type BridgeServices = Database | Player | Kotlin | DesktopLibrary | Playback;

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

const playbackCall = <A>(run: (playback: Playback["Service"]) => A | Promise<A>) =>
  Effect.gen(function* () {
    const playback = yield* Playback;
    return yield* Effect.tryPromise({ try: async () => run(playback), catch: (error) => error });
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

const createHandlers = (onAppearance: (mode: Appearance) => void): Handlers => {
  let loadedPath: string | undefined;
  const checkAvailable = (path: string | undefined) =>
    Effect.gen(function* () {
      const library = yield* DesktopLibrary;
      if (path !== undefined && library.unavailable(path))
        return yield* Effect.fail(new Error("[folder-unavailable] Drive is not connected"));
    });
  return {
    "playback.view": () => playbackCall((p) => p.view()),
    "playback.start": ([scope, index, shuffle]) =>
      validScope(scope) &&
      !["albums", "artists", "playlists", "genres"].includes(scope.kind) &&
      (index === undefined ||
        (typeof index === "number" && Number.isSafeInteger(index) && index >= 0)) &&
      (shuffle === undefined || typeof shuffle === "boolean")
        ? playbackCall((p) =>
            p.start(scope, index as number | undefined, shuffle as boolean | undefined),
          )
        : refuse("playback.start", "invalid play context"),
    "playback.command": ([command]) =>
      validPlaybackCommand(command)
        ? playbackCall((p) => p.command(command))
        : refuse("playback.command", "invalid command"),
    "playback.play": () => playbackCall((p) => p.play()),
    "playback.pause": () => playbackCall((p) => p.pause()),
    "playback.seek": ([ms]) =>
      typeof ms === "number" && Number.isFinite(ms) && ms >= 0
        ? playbackCall((p) => p.seek(ms))
        : refuse("playback.seek", "invalid time"),
    "playback.undo": () => playbackCall((p) => p.undo()),
    "playback.dismissUndo": () => playbackCall((p) => p.dismissUndo()),
    "playback.favorite": () => playbackCall((p) => p.favorite()),
    "playback.volume": ([value, muted]) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1 &&
      typeof muted === "boolean"
        ? playbackCall((p) => p.volume(value, muted))
        : refuse("playback.volume", "invalid volume"),
    "playback.queue": ([offset, limit]) =>
      typeof offset === "number" &&
      Number.isSafeInteger(offset) &&
      offset >= 0 &&
      typeof limit === "number" &&
      Number.isSafeInteger(limit) &&
      limit > 0 &&
      limit <= 200
        ? playbackCall((p) => p.queue(offset, limit))
        : refuse("playback.queue", "invalid page"),
    "settings.appearance": () =>
      Effect.gen(function* () {
        return appearance(yield* Database);
      }),
    "settings.setAppearance": ([mode]) =>
      mode === "light" || mode === "dark" || mode === "system"
        ? Effect.gen(function* () {
            savePreference(yield* Database, "appearance", mode);
            onAppearance(mode);
          })
        : refuse("settings.setAppearance", "invalid appearance"),
    "settings.playback": () => playbackCall((p) => p.settings()),
    "settings.setPlayback": ([change]) =>
      validPlaybackSettings(change)
        ? playbackCall((p) => p.setSettings(change))
        : refuse("settings.setPlayback", "invalid playback settings"),
    "library.artwork": ([hash, large]) =>
      typeof hash === "string" && /^[a-f0-9]{40}$/.test(hash) && typeof large === "boolean"
        ? Effect.gen(function* () {
            const db = yield* Database;
            return yield* Effect.promise(() => readArtwork(db, hash, large));
          })
        : refuse("library.artwork", "invalid artwork"),
    "library.browse": ([scope, offset, limit]) =>
      validScope(scope)
        ? pageCall("library.browse", [offset, limit], (library, offset, limit) =>
            library.browse(scope, offset, limit),
          )
        : refuse("library.browse", "invalid scope"),
    "library.letter": ([scope, letter]) =>
      validScope(scope) && typeof letter === "string" && /^[a-z0-9]$/i.test(letter)
        ? Effect.gen(function* () {
            return browseLetter(yield* Database, scope, letter);
          })
        : refuse("library.letter", "invalid letter or scope"),
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
  onAppearance: (mode: Appearance) => void = () => {},
): void => {
  const handlers = createHandlers(onAppearance);
  for (const call of BRIDGE_CALLS) {
    const handler: (args: readonly unknown[]) => Effect.Effect<unknown, unknown, BridgeServices> =
      handlers[call];
    ipcMain.handle(call, async (event, ...args) => {
      if (!isTrusted(event)) throw new Error(`Refused ${call} from an untrusted frame`);
      return runtime.runPromise(handler(args));
    });
  }
};
