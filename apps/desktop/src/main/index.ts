import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  net,
  shell,
  nativeImage,
  nativeTheme,
  safeStorage,
} from "electron";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { forkAudio } from "./audio/fork.ts";
import { streamingPlayerLayer } from "./audio/player.ts";
import { registerBridge } from "./bridge.ts";
import { playbackLayer } from "./playback/playback.ts";
import { libraryLayer } from "./database.ts";
import { kotlinLayer } from "./kotlin/kotlin.ts";
import { jvmCommand, spawnLines } from "./kotlin/spawn.ts";
import { guardWindow } from "./security.ts";
import { desktopLibraryLayer } from "./library/library.ts";
import { desktopPlaylistsLayer } from "./library/playlists.ts";
import { nativeImageCodec } from "./library/nativeImageCodec.ts";
import { Database } from "@wave/client";
import * as Effect from "effect/Effect";
import {
  DEFAULT_THEME_CHOICE,
  catalogueOf,
  desktopKey,
  readThemeChoice,
  resolveAppLanguage,
  themeFor,
  type ThemeChoice,
} from "@wave/core";
import { appearance } from "./preferences.ts";
import { artworkStore } from "./library/artwork.ts";
import { ytMusicLayer } from "./yt/ytMusic.ts";
import { ytFeaturesLayer } from "./yt/ytServices.ts";
import { lyricsLayer } from "./lyrics/lyrics.ts";
import { botguardPost, createPoTokens, poTokenHost } from "./yt/poTokens.ts";
import { openPoTokenPage } from "./yt/poTokenWindow.ts";
import { createWaveAccount } from "./account/account.ts";
import { Account, accountLayer } from "./account/accountLayer.ts";
import { signInWithBrowser } from "./account/browserSignIn.ts";
import { accountConfig } from "./account/config.ts";
import { sessionStore } from "./account/sessionStore.ts";

// %APPDATA%\Wave or ~/.config/Wave, from the product name; tests point it at a folder of their own.
const dataFolder = process.env["WAVE_DATA_DIR"];
if (dataFolder !== undefined && dataFolder !== "") app.setPath("userData", dataFolder);

let window: BrowserWindow | undefined;

/**
 * Wave's caches: %LOCALAPPDATA%\Wave or ~/.cache/wave (cover art, streamed audio); tests point
 * them at their own folder with WAVE_DATA_DIR.
 */
const cacheFolder = (name: string) =>
  join(
    process.env["WAVE_DATA_DIR"] ??
      (process.platform === "win32"
        ? join(process.env["LOCALAPPDATA"] ?? join(app.getPath("home"), "AppData", "Local"), "Wave")
        : join(process.env["XDG_CACHE_HOME"] ?? join(app.getPath("home"), ".cache"), "wave")),
    name,
  );

/** Proof-of-origin tokens for the JVM's YouTube requests, minted in a hidden window. */
const poTokens = createPoTokens({ openPage: openPoTokenPage, post: botguardPost() });

const showWindow = () => {
  if (window === undefined) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
};

// The account's theme once the services are up (docs/spec-desktop.md, Wave account and sync).
let theme: ThemeChoice = DEFAULT_THEME_CHOICE;
const colours = () => themeFor(theme)[nativeTheme.shouldUseDarkColors ? "dark" : "light"];
/**
 * Opens the window and loads its page while the services are still starting, and shows it once
 * both are done: the page is loaded by then, and the account's theme is known before it's seen.
 */
const createWindow = (onFocus: () => void, services: Promise<void>) => {
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
  // Ctrl+Q quits from anywhere in the window, a field included.
  created.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      desktopKey(
        { key: input.key, ctrl: input.control, alt: input.alt, shift: input.shift },
        "other",
      ) === "quit"
    ) {
      event.preventDefault();
      app.quit();
    }
  });
  const painted = new Promise<void>((resolve) => created.once("ready-to-show", () => resolve()));
  void Promise.all([painted, services]).then(
    () => {
      if (created.isDestroyed()) return;
      created.setBackgroundColor(colours().background);
      update();
      created.show();
    },
    // Without its services Wave has nothing to show; the failure is reported where they start.
    () => {},
  );
  created.on("closed", () => {
    window = undefined;
    // The token window is hidden, so it alone mustn't keep Wave running.
    poTokens.close();
    app.quit();
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
  created.on("focus", () => {
    onFocus();
    update();
  });
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
    const base = Layer.mergeAll(
      libraryLayer(join(app.getPath("userData"), "wave.db")),
      kotlinLayer({
        spawn: spawnLines(jvm, (text) => process.stderr.write(`[jvm] ${text}`)),
        host: { poToken: poTokenHost(poTokens) },
      }),
    );
    // The player streams YT Music songs through YtMusic, into the bounded audio cache.
    const services = Layer.mergeAll(
      streamingPlayerLayer({
        fork: forkAudio(join(import.meta.dirname, "audio.js"), addon, cacheFolder("audio")),
      }),
    ).pipe(Layer.provideMerge(ytMusicLayer()), Layer.provideMerge(base));
    const library = desktopLibraryLayer({
      // Electron resolves Windows' Music known folder and Linux's XDG user directory.
      musicFolder: process.env["WAVE_MUSIC_DIR"] ?? app.getPath("music"),
      platform: process.platform,
      cacheArtwork: (() => {
        let store: ReturnType<typeof artworkStore> | undefined;
        return (db, encoded) => {
          store ??= artworkStore(db, cacheFolder("artwork"), (bytes) => {
            const image = nativeImage.createFromBuffer(bytes);
            if (image.isEmpty()) return undefined;
            const { width, height } = image.getSize();
            const resized = (side: number) =>
              image
                .resize(
                  width >= height
                    ? { width: Math.min(side, width), quality: "good" }
                    : { height: Math.min(side, height), quality: "good" },
                )
                .toJPEG(90);
            return { thumb: resized(300), medium: resized(640) };
          });
          return store(encoded);
        };
      })(),
      pickFolder: async () => {
        const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
        return result.canceled ? undefined : result.filePaths[0];
      },
    }).pipe(Layer.provideMerge(services));
    const text = catalogueOf(resolveAppLanguage(app.getPreferredSystemLanguages()), "desktop");
    const config = accountConfig(
      // Named one by one: the bundler puts each value in, not the whole environment.
      {
        MAIN_VITE_WAVE_SYNC_URL: import.meta.env.MAIN_VITE_WAVE_SYNC_URL,
        MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_ID: import.meta.env
          .MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_ID,
        MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_SECRET: import.meta.env
          .MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_SECRET,
      },
      process.env,
      app.isPackaged,
    );
    const { clientId } = config;
    const account = createWaveAccount({
      // The session stays in main, sealed by the system's keyring; without one it isn't written.
      store: sessionStore({
        box: safeStorage,
        file: join(app.getPath("userData"), "wave-session.bin"),
        files: {
          read: (path) => {
            try {
              return readFileSync(path);
            } catch {
              return undefined;
            }
          },
          write: (path, bytes) => writeFileSync(path, bytes, { mode: 0o600 }),
          remove: (path) => rmSync(path, { force: true }),
        },
        platform: process.platform,
      }),
      syncUrl: config.syncUrl,
      signInWithBrowser: (signal) =>
        clientId === null
          ? Promise.reject(new Error("This build has no Google client."))
          : signInWithBrowser({
              authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
              tokenUrl: "https://oauth2.googleapis.com/token",
              clientId,
              ...(config.clientSecret === undefined ? {} : { clientSecret: config.clientSecret }),
              openExternal: (url) => shell.openExternal(url),
              fetch,
              page: {
                title: text.desktopAccount.browserTitle,
                message: text.desktopAccount.browserMessage,
              },
              signal,
            }),
      fetch,
      online: () => net.isOnline(),
    });
    const playlists = desktopPlaylistsLayer({
      platform: process.platform,
      imageFolder: join(app.getPath("userData"), "playlist-images"),
      codec: nativeImageCodec(nativeImage),
      pickImage: async () => {
        const result = await dialog.showOpenDialog({
          title: text.itemActions.labels.changeImage,
          properties: ["openFile"],
          // Format names, which read the same in every language.
          filters: [{ name: "JPEG, PNG", extensions: ["jpg", "jpeg", "png"] }],
        });
        return result.canceled ? undefined : result.filePaths[0];
      },
      pickPlaylists: async () => {
        const result = await dialog.showOpenDialog({
          title: text.playlists.importPlaylists,
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "M3U", extensions: ["m3u", "m3u8"] }],
        });
        return result.canceled ? [] : result.filePaths;
      },
    });
    const runtime = ManagedRuntime.make(
      accountLayer({
        account,
        focused: () => BrowserWindow.getFocusedWindow() !== null,
      }).pipe(
        Layer.provideMerge(
          ytFeaturesLayer({ online: () => net.isOnline() }).pipe(
            Layer.provideMerge(
              playlists.pipe(
                Layer.provideMerge(
                  Layer.mergeAll(playbackLayer, lyricsLayer()).pipe(Layer.provideMerge(library)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    const readTheme = () =>
      runtime.runPromise(Effect.map(Account, (it) => readThemeChoice(it.view().theme)));
    // Builds the services now, so the JVM starts with the app rather than on the first call.
    const started = (async () => {
      await runtime.context();
      nativeTheme.themeSource = await runtime.runPromise(Effect.map(Database, appearance));
      theme = await readTheme();
    })();
    // A call from the page waits for the services it needs.
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
    // The queue's position and the play so far are saved before the app exits.
    let quitting = false;
    app.on("before-quit", (event) => {
      if (quitting) return;
      event.preventDefault();
      quitting = true;
      void runtime.dispose().finally(() => app.quit());
    });
    createWindow(() => {
      // Back after five minutes away, the Library pulls; the account may have changed the theme.
      void runtime.runPromise(Effect.map(Account, (it) => it.foreground()));
      void readTheme().then((choice) => {
        theme = choice;
      });
    }, started);
    await started;
  });
}
