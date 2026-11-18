import { join } from "node:path";
import { BrowserWindow, app, dialog, ipcMain, shell, nativeImage, nativeTheme } from "electron";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { forkAudio } from "./audio/fork.ts";
import { playerLayer } from "./audio/player.ts";
import { registerBridge } from "./bridge.ts";
import { libraryLayer } from "./database.ts";
import { kotlinLayer } from "./kotlin/kotlin.ts";
import { jvmCommand, spawnLines } from "./kotlin/spawn.ts";
import { guardWindow } from "./security.ts";
import { desktopLibraryLayer } from "./library/library.ts";
import { Database } from "@wave/client";
import * as Effect from "effect/Effect";
import { DEFAULT_THEME_CHOICE, themeFor } from "@wave/core";
import { appearance } from "./preferences.ts";
import { artworkStore } from "./library/artwork.ts";

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

const colours = () =>
  themeFor(DEFAULT_THEME_CHOICE)[nativeTheme.shouldUseDarkColors ? "dark" : "light"];
const createWindow = () => {
  const created = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: colours().background,
    ...(process.platform === "win32"
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: colours().background,
            symbolColor: colours().foreground,
            height: 48,
          },
        }
      : {}),
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
  const update = () => {
    if (!created.isDestroyed() && process.platform === "win32")
      created.setTitleBarOverlay({
        color: colours().background,
        symbolColor: colours().foreground,
        height: 48,
      });
  };
  nativeTheme.on("updated", update);
  created.on("closed", () => nativeTheme.removeListener("updated", update));
};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", showWindow);
  app.on("window-all-closed", () => app.quit());
  // Utility processes start only once the app is ready, so the services wait for it too.
  void app.whenReady().then(async () => {
    // The engine built by `pnpm build:native`; tests may point at another build.
    const addon =
      process.env["WAVE_AUDIO_ADDON"] ?? join(app.getAppPath(), "native", "wave-audio.node");
    // The runtime and JAR from `pnpm build:jvm`; tests may point at others.
    const jvm = jvmCommand({
      runtime: process.env["WAVE_JVM_RUNTIME"] ?? join(app.getAppPath(), "jvm", "runtime"),
      jar: process.env["WAVE_KOTLIN_JAR"] ?? join(app.getAppPath(), "jvm", "wave-kotlin.jar"),
      dataDir: join(app.getPath("userData"), "kotlin"),
      platform: process.platform,
    });
    const services = Layer.mergeAll(
      libraryLayer(join(app.getPath("userData"), "wave.db")),
      playerLayer({ fork: forkAudio(join(import.meta.dirname, "audio.js"), addon) }),
      kotlinLayer({
        spawn: spawnLines(jvm, (text) => process.stderr.write(`[jvm] ${text}`)),
      }),
    );
    const runtime = ManagedRuntime.make(
      desktopLibraryLayer({
        // Electron resolves Windows' Music known folder and Linux's XDG user directory.
        musicFolder: process.env["WAVE_MUSIC_DIR"] ?? app.getPath("music"),
        platform: process.platform,
        cacheArtwork: (() => {
          let store: ReturnType<typeof artworkStore> | undefined;
          return (db, encoded) => {
            store ??= artworkStore(
              db,
              join(
                process.env["WAVE_DATA_DIR"] ??
                  (process.platform === "win32"
                    ? join(
                        process.env["LOCALAPPDATA"] ??
                          join(app.getPath("home"), "AppData", "Local"),
                        "Wave",
                      )
                    : join(
                        process.env["XDG_CACHE_HOME"] ?? join(app.getPath("home"), ".cache"),
                        "wave",
                      )),
                "artwork",
              ),
              (bytes, size) => {
                const image = nativeImage.createFromBuffer(bytes);
                return image.isEmpty()
                  ? Buffer.alloc(0)
                  : image.resize({ width: size, height: size, quality: "good" }).toPNG();
              },
            );
            return store(encoded);
          };
        })(),
        pickFolder: async () => {
          const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
          return result.canceled ? undefined : result.filePaths[0];
        },
      }).pipe(Layer.provideMerge(services)),
    );
    // Builds the services now, so the JVM starts with the app rather than on the first call.
    await runtime.context();
    nativeTheme.themeSource = await runtime.runPromise(Effect.map(Database, appearance));
    registerBridge(
      ipcMain,
      runtime,
      (event) =>
        window !== undefined &&
        (event as Electron.IpcMainInvokeEvent).senderFrame === window.webContents.mainFrame,
      (mode) => {
        nativeTheme.themeSource = mode;
      },
    );
    app.on("will-quit", () => void runtime.dispose());
    createWindow();
  });
}
