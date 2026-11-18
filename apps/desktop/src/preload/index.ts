import { contextBridge, ipcRenderer } from "electron";
import { exposeBridge } from "./expose.ts";

exposeBridge(contextBridge, ipcRenderer);
