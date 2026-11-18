import { join } from "node:path";
import { BrowserWindow, app, ipcMain, shell } from "electron";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { registerBridge } from "./bridge.ts";
import { libraryLayer } from "./database.ts";
import { guardWindow } from "./security.ts";

// %APPDATA%\Wave or ~/.config/Wave, from the product name; tests point it at a folder of their own.
const dataFolder = process.env["WAVE_DATA_DIR"];
if (dataFolder !== undefined && dataFolder !== "") app.setPath("userData", dataFolder);

let window: BrowserWindow | undefined;

const showWindow = () => {
  if (window === undefined) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
};

const createWindow = () => {
  const created = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Wave",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  guardWindow(created.webContents, (url) => void shell.openExternal(url));
  created.once("ready-to-show", () => created.show());
  created.on("closed", () => {
    window = undefined;
  });
  const devServer = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devServer !== undefined) void created.loadURL(devServer);
  else void created.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  window = created;
};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", showWindow);
  const runtime = ManagedRuntime.make(libraryLayer(join(app.getPath("userData"), "wave.db")));
  registerBridge(
    ipcMain,
    runtime,
    (event) =>
      window !== undefined &&
      (event as Electron.IpcMainInvokeEvent).senderFrame === window.webContents.mainFrame,
  );
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => void runtime.dispose());
  void app.whenReady().then(createWindow);
}
