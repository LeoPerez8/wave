/** Main's side of the bridge: one IPC handler per call in the contract. */
import { Database } from "@wave/client";
import { libraryCounts } from "@wave/client/db/counts";
import * as Effect from "effect/Effect";
import { BRIDGE_CALLS, type BridgeCall, type BridgeContract } from "../shared/bridge.ts";

export type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

interface IpcMainLike {
  readonly handle: (channel: string, handler: IpcHandler) => void;
}

interface Runtime<R> {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
}

/** What each call does; `args` come from the window and are checked here before use. */
const HANDLERS: {
  readonly [C in BridgeCall]: (
    args: readonly unknown[],
  ) => Effect.Effect<BridgeContract[C]["result"], unknown, Database>;
} = {
  "library.counts": () =>
    Effect.gen(function* () {
      return libraryCounts(yield* Database);
    }),
};

/** Registers every call, answering only frames `isTrusted` accepts. */
export const registerBridge = (
  ipcMain: IpcMainLike,
  runtime: Runtime<Database>,
  isTrusted: (event: unknown) => boolean,
): void => {
  for (const call of BRIDGE_CALLS)
    ipcMain.handle(call, async (event, ...args) => {
      if (!isTrusted(event)) throw new Error(`Refused ${call} from an untrusted frame`);
      return runtime.runPromise(HANDLERS[call](args));
    });
};
