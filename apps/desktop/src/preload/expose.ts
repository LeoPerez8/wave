import { createBridge } from "../shared/bridge.ts";

interface ContextBridgeLike {
  readonly exposeInMainWorld: (key: string, api: unknown) => void;
}

interface IpcRendererLike {
  readonly invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

/** Hands the window the typed bridge; `ipcRenderer` itself never crosses into the page. */
export const exposeBridge = (contextBridge: ContextBridgeLike, ipcRenderer: IpcRendererLike) => {
  contextBridge.exposeInMainWorld(
    "wave",
    createBridge((call, ...args) => ipcRenderer.invoke(call, ...args) as never),
  );
};
