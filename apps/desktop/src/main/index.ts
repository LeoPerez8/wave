import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BrowserWindow,
  ClipboardItem,
  clipboard,
  app,
  desktopCapturer,
  dialog,
  ipcMain,
  net,
  shell,
  nativeImage,
  nativeTheme,
  safeStorage,
  session as electronSession,
  systemPreferences,
} from "electron";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { forkAudio } from "./audio/fork.ts";
import { streamingPlayerLayer } from "./audio/player.ts";
import { desktopBuild, startDesktopUpdates } from "./updates/updater.ts";
import { createDesktopVersionHistory } from "./updates/history.ts";
import { registerBridge } from "./bridge.ts";
import { playbackLayer } from "./playback/playback.ts";
import { libraryLayer } from "./database.ts";
import { kotlinLayer } from "./kotlin/kotlin.ts";
import { jvmCommand, spawnLines } from "./kotlin/spawn.ts";
import { guardWindow, windowWebPreferences } from "./security.ts";
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
  chosenAppLanguage,
  themeFor,
  type ThemeChoice,
} from "@wave/core";
import { appearance } from "./preferences.ts";
import { artworkStore } from "./library/artwork.ts";
import { createLibraryArtwork } from "./library/onlineArtwork.ts";
import { lookupsEnabled } from "./lookupSettings.ts";
import { artistPhotosEnabled } from "./library/lyricsAndTags.ts";
import { ytMusicLayer } from "./yt/ytMusic.ts";
import { desktopLinksLayer } from "./links/layer.ts";
import { cardImagesLayer } from "./cards/cardImages.ts";
import { downloadsLayer } from "./downloads/downloadsLayer.ts";
import { keyringHost } from "./downloads/keyring.ts";
import type { KotlinEvent } from "./kotlin/protocol.ts";
import { ytFeaturesLayer } from "./yt/ytServices.ts";
import { lyricsLayer } from "./lyrics/lyrics.ts";
import { geniusLyricsSearchLayer } from "./lyrics/geniusLyricsSearchLayer.ts";
import { guardCapture } from "./recognize/capturePermissions.ts";
import { fetchCover } from "./recognize/cover.ts";
import { Recognize, recognizeLayer, type RecognizeShape } from "./recognize/recognizeLayer.ts";
import { botguardPost, createPoTokens, poTokenHost } from "./yt/poTokens.ts";
import { openPoTokenPage } from "./yt/poTokenWindow.ts";
import { createWaveAccount } from "./account/account.ts";
import { withHomeFollow } from "./follows/homeFollow.ts";
import { Account, accountLayer } from "./account/accountLayer.ts";
import { signInWithBrowser } from "./account/browserSignIn.ts";
import { accountConfig } from "./account/config.ts";
import { sessionStore } from "./account/sessionStore.ts";
import { installDesktopSystem } from "./system/desktopSystem.ts";
import { installMiniPlayer } from "./system/miniPlayerWindow.ts";
import { configureAutostart } from "./system/autostart.ts";
import { followStart } from "./system/startup.ts";
import { createOpenedFiles, launchFiles } from "./system/openedFiles.ts";
import { Playback } from "./playback/playback.ts";
import { YtMusic } from "./yt/ytMusic.ts";
import { ytAccountLayer } from "./yt/ytAccountLayer.ts";
import { createYtSessions, ytSessionStore } from "./yt/ytSessionStore.ts";
import { ytSignInSystem } from "./yt/ytSignInSystem.ts";
import { spotifySessionStore } from "./spotify/spotifyAccount.ts";
import { spotifyAccountLayer } from "./spotify/spotifyAccountLayer.ts";
import { spotifyImportLayer } from "./spotify/spotifyImportLayer.ts";

// %APPDATA%\Wave or ~/.config/Wave, from the product name; tests point it at a folder of their own.
const dataFolder = process.env["WAVE_DATA_DIR"];
if (dataFolder !== undefined && dataFolder !== "") app.setPath("userData", dataFolder);

let window: BrowserWindow | undefined;
let system: ReturnType<typeof installDesktopSystem> | undefined;
let showRequested = false;
// Set once the page is loaded and the services are up, or took too long; the window isn't shown
// before.
let windowReady = false;

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
  showRequested = true;
  if (window === undefined || !windowReady) return;
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
 * Services that take too long don't keep it hidden, and `failed` hears of services that fail
 * (`followStart`).
 */
const createWindow = (
  onFocus: () => void,
  services: Promise<void>,
  failed: (error: unknown) => void,
) => {
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
    webPreferences: windowWebPreferences(join(import.meta.dirname, "../preload/index.cjs")),
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
  followStart({
    painted,
    services,
    started: () => {
      if (created.isDestroyed()) return;
      created.setBackgroundColor(colours().background);
      update();
    },
    reveal: () => {
      if (created.isDestroyed()) return;
      windowReady = true;
      // Started with the system, Wave stays in the tray until it's asked for.
      if (!process.argv.includes("--hidden") || showRequested) created.show();
    },
    failed,
  });
  created.on("closed", () => {
    window = undefined;
    system?.close();
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

/** Plays the files Wave was opened with, once the services are up; set as they start. */
let playOpenedFiles: (paths: readonly string[]) => void = () => {};
const openedFiles = createOpenedFiles({ play: (paths) => playOpenedFiles(paths) });

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // A launch while Wave runs hands its files to this window, which comes forward either way.
  app.on("second-instance", (_event, argv, workingDirectory) => {
    openedFiles.opened(launchFiles(argv, workingDirectory));
    showWindow();
  });
  openedFiles.opened(launchFiles(process.argv, process.cwd()));
  app.on("window-all-closed", () => app.quit());
  // Utility processes start only once the app is ready, so the services wait for it too.
  void app.whenReady().then(async () => {
    const installUpdate = startDesktopUpdates();
    const resources = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const preferredLanguages = () => {
      const launchLanguage = app.commandLine.getSwitchValue("lang");
      return launchLanguage ? [launchLanguage] : app.getPreferredSystemLanguages();
    };
    // Until the database opens, the system's language; then the choice the account layer reads.
    let language = chosenAppLanguage("system", preferredLanguages());
    let text = catalogueOf(language, "desktop");
    // The engine built by `pnpm build:native`; tests may point at another build.
    const addon = process.env["WAVE_AUDIO_ADDON"] ?? join(resources, "native", "wave-audio.node");
    // The runtime and JAR from `pnpm build:jvm`; tests may point at others.
    const jvm = jvmCommand({
      runtime: process.env["WAVE_JVM_RUNTIME"] ?? join(resources, "jvm", "runtime"),
      jar: process.env["WAVE_KOTLIN_JAR"] ?? join(resources, "jvm", "wave-kotlin.jar"),
      dataDir: join(app.getPath("userData"), "kotlin"),
      platform: process.platform,
      // Tests point Recognize at a fake Shazam; a packaged Wave always asks Shazam.
      shazamUrl: app.isPackaged ? undefined : process.env["WAVE_SHAZAM_URL"],
    });
    // What the JVM tells main unasked (`ready`, `downloadsChanged`), for whoever listens.
    const kotlinListeners = new Set<(event: KotlinEvent) => void>();
    const sealedFiles = {
      read: (path: string) => {
        try {
          return readFileSync(path);
        } catch {
          return undefined;
        }
      },
      write: (path: string, bytes: Buffer) => writeFileSync(path, bytes, { mode: 0o600 }),
      remove: (path: string) => rmSync(path, { force: true }),
    };
    // The YouTube session stays in main, sealed by the system's keyring, and the JVM asks for it
    // each time it starts; without a keyring it is never written.
    const ytSessions = createYtSessions(
      ytSessionStore({
        box: safeStorage,
        file: join(app.getPath("userData"), "yt-session.bin"),
        files: sealedFiles,
        platform: process.platform,
      }),
    );
    const ytSignIn = ytSignInSystem({
      userData: app.getPath("userData"),
      home: app.getPath("home"),
      platform: process.platform,
      env: process.env,
      log: (line) =>
        process.stderr.write(`[yt] ${line}
`),
    });
    void ytSignIn.sweep();
    const base = Layer.mergeAll(
      libraryLayer(join(app.getPath("userData"), "wave.db")),
      kotlinLayer({
        spawn: spawnLines(jvm, (text) => process.stderr.write(`[jvm] ${text}`)),
        host: { poToken: poTokenHost(poTokens), ...keyringHost(safeStorage), ...ytSessions.host },
        onEvent: (event) => {
          for (const listener of kotlinListeners) listener(event);
        },
      }),
    );
    // The player streams YT Music songs through YtMusic, into the bounded audio cache.
    const services = Layer.mergeAll(
      streamingPlayerLayer({
        fork: forkAudio(join(import.meta.dirname, "audio.js"), addon, cacheFolder("audio")),
      }),
    ).pipe(Layer.provideMerge(ytMusicLayer()), Layer.provideMerge(base));
    // Electron resolves Windows' Music known folder and Linux's XDG user directory.
    const musicFolder = process.env["WAVE_MUSIC_DIR"] ?? app.getPath("music");
    const pickFolder = async () => {
      const result = await dialog.showOpenDialog({
        title: text.settings.addFolder,
        buttonLabel: text.desktopLayout.open,
        properties: ["openDirectory"],
      });
      return result.canceled ? undefined : result.filePaths[0];
    };
    const library = desktopLibraryLayer({
      musicFolder,
      platform: process.platform,
      onlineArtwork: (db, ytMusic) =>
        createLibraryArtwork({
          db,
          coversEnabled: () => lookupsEnabled(db),
          ytMusicOn: ytMusic.on,
          videoCover: ytMusic.videoCover,
          directory: cacheFolder("online-artwork"),
          photosEnabled: () => artistPhotosEnabled(db),
          process: (bytes) => {
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
          },
        }),
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
      pickFolder,
      // Called when Show in Folder runs, so an e2e run can stand in for the file manager.
      showItemInFolder: (path) => shell.showItemInFolder(path),
    }).pipe(Layer.provideMerge(services));
    const downloads = downloadsLayer({
      get catalogue() {
        return text;
      },
      language: () => language,
      platform: process.platform,
      musicFolder,
      pickFolder,
      online: () => net.isOnline(),
      events: (listener) => {
        kotlinListeners.add(listener);
        return () => kotlinListeners.delete(listener);
      },
      log: (level, message) =>
        process.stderr.write(`[downloads] ${level}: ${message}
`),
    }).pipe(Layer.provideMerge(library));
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
    const spotifyClientId =
      (app.isPackaged ? undefined : process.env["WAVE_SPOTIFY_CLIENT_ID"]?.trim() || undefined) ??
      (import.meta.env.MAIN_VITE_WAVE_SPOTIFY_CLIENT_ID?.trim() || null);
    const account = createWaveAccount({
      // The session stays in main, sealed by the system's keyring; without one it isn't written.
      store: sessionStore({
        box: safeStorage,
        file: join(app.getPath("userData"), "wave-session.bin"),
        files: sealedFiles,
        platform: process.platform,
      }),
      syncUrl: config.syncUrl,
      signInWithBrowser: (signal, purpose) =>
        clientId === null
          ? Promise.reject(new Error("This build has no Google client."))
          : signInWithBrowser({
              authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
              tokenUrl: config.tokenUrl,
              clientId,
              ...(config.clientSecret === undefined ? {} : { clientSecret: config.clientSecret }),
              openExternal: (url) => shell.openExternal(url),
              fetch,
              page: {
                title: text.desktopAccount.browserTitle,
                message:
                  purpose === "confirmDeletion"
                    ? text.desktopAccount.browserDeletionMessage
                    : text.desktopAccount.browserMessage,
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
          buttonLabel: text.desktopLayout.open,
          properties: ["openFile"],
          // Format names, which read the same in every language.
          filters: [{ name: "JPEG, PNG", extensions: ["jpg", "jpeg", "png"] }],
        });
        return result.canceled ? undefined : result.filePaths[0];
      },
      pickPlaylists: async () => {
        const result = await dialog.showOpenDialog({
          title: text.playlists.importPlaylists,
          buttonLabel: text.desktopLayout.open,
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "M3U", extensions: ["m3u", "m3u8"] }],
        });
        return result.canceled ? [] : result.filePaths;
      },
    });
    const runtime = ManagedRuntime.make(
      accountLayer({
        account,
        preferredLanguages,
        languageChanged: (view) => {
          language = view.language;
          text = catalogueOf(language, "desktop");
        },
        // An edit in Settings › Appearance, or a pull: the window's frame follows at once.
        themeChanged: (stored) => {
          theme = readThemeChoice(stored);
          if (window === undefined || window.isDestroyed()) return;
          window.setBackgroundColor(colours().background);
          if (process.platform === "win32")
            window.setTitleBarOverlay({
              color: colours().background,
              symbolColor: colours().foreground,
              height: 48,
            });
        },
        focused: () => BrowserWindow.getFocusedWindow() !== null,
      }).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            cardImagesLayer({
              save: async (fileName, png) => {
                const options = {
                  defaultPath: join(app.getPath("pictures"), fileName),
                  filters: [{ name: "PNG", extensions: ["png"] }],
                };
                const window = BrowserWindow.getFocusedWindow();
                const result = await (window === null
                  ? dialog.showSaveDialog(options)
                  : dialog.showSaveDialog(window, options));
                if (result.canceled || !result.filePath) return false;
                await writeFile(result.filePath, png);
                return true;
              },
              copy: (png) =>
                clipboard.write([
                  new ClipboardItem({
                    "image/png": new Blob([Buffer.from(png)], { type: "image/png" }),
                  }),
                ]),
            }),
            desktopLinksLayer({
              online: () => net.isOnline(),
              writeClipboard: (text) => clipboard.writeText(text),
            }),
            geniusLyricsSearchLayer({
              account,
              online: () => net.isOnline(),
              openExternal: (url) => shell.openExternal(url),
            }),
            recognizeLayer({
              online: () => net.isOnline(),
              // Windows' privacy switch for desktop apps; Linux has none to read.
              microphone: () =>
                process.platform === "linux" ||
                systemPreferences.getMediaAccessStatus("microphone") === "granted" ||
                systemPreferences.getMediaAccessStatus("microphone") === "not-determined"
                  ? "granted"
                  : "denied",
              systemAudio: process.platform === "linux" ? "monitor" : "loopback",
              catalogue: () => text,
              language: () => language,
              events: (listener) => {
                kotlinListeners.add(listener);
                return () => kotlinListeners.delete(listener);
              },
              openPrivacySettings:
                process.platform === "win32"
                  ? () => shell.openExternal("ms-settings:privacy-microphone")
                  : null,
              fetchCover: (url) => fetchCover(url, fetch),
              log: (level, line) =>
                process.stderr.write(`[recognize] ${level}: ${line}
`),
            }),
            ytAccountLayer({
              sessions: ytSessions,
              online: () => net.isOnline(),
              startSignIn: ytSignIn.start,
            }),
            spotifyImportLayer({ fetch: (input, init) => globalThis.fetch(input, init) }).pipe(
              Layer.provideMerge(
                spotifyAccountLayer({
                  clientId: spotifyClientId,
                  store: spotifySessionStore({
                    box: safeStorage,
                    file: join(app.getPath("userData"), "spotify-session.bin"),
                    files: {
                      ...sealedFiles,
                      // A refresh can rotate the token. An interrupted write leaves the old file readable.
                      write: (file, bytes) => {
                        const temp = `${file}.tmp`;
                        try {
                          sealedFiles.write(temp, bytes);
                          renameSync(temp, file);
                        } finally {
                          sealedFiles.remove(temp);
                        }
                      },
                      remove: (file) => {
                        sealedFiles.remove(`${file}.tmp`);
                        sealedFiles.remove(file);
                      },
                    },
                    platform: process.platform,
                  }),
                  openExternal: (url) => shell.openExternal(url),
                  online: () => net.isOnline(),
                  fetch: (input, init) => globalThis.fetch(input, init),
                  page: () => ({
                    title: text.desktopAccount.browserTitle,
                    message: text.desktopAccount.browserMessage,
                  }),
                }),
              ),
            ),
          ).pipe(
            Layer.provideMerge(
              ytFeaturesLayer({ online: () => net.isOnline(), language: () => language }).pipe(
                Layer.provideMerge(
                  playlists.pipe(
                    Layer.provideMerge(
                      Layer.mergeAll(playbackLayer, lyricsLayer()).pipe(
                        Layer.provideMerge(downloads),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        withHomeFollow({
          request: account.request,
          configured: config.syncUrl !== null,
          signedIn: () => account.session().status === "signedIn",
          online: () => net.isOnline(),
          // Shows are looked up in the system's region; the phone's country choice isn't synced.
          country: () => app.getLocaleCountryCode(),
          fetch,
        }),
      ),
    );
    // Only Recognize's session may capture, and only once the services are up.
    let recognize: RecognizeShape | undefined;
    guardCapture(electronSession.defaultSession, {
      trusted: (contents) => window !== undefined && contents === window.webContents,
      trustedFrame: (frame) => window !== undefined && frame === window.webContents.mainFrame,
      allows: (kind) => recognize?.allows(kind) ?? false,
      screen: async () =>
        (
          await desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: { width: 0, height: 0 },
          })
        )[0],
      loopback: process.platform === "win32",
    });
    const readTheme = () =>
      runtime.runPromise(Effect.map(Account, (it) => readThemeChoice(it.view().theme)));
    // Builds the services now, so the JVM starts with the app rather than on the first call.
    const started = (async () => {
      await runtime.context();
      nativeTheme.themeSource = await runtime.runPromise(Effect.map(Database, appearance));
      theme = await readTheme();
    })();
    // The floating mini player: a second window on the same preload and page rules.
    const miniPlayer = installMiniPlayer({
      db: () => started.then(() => runtime.runPromise(Database)),
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      load: (mini) => {
        const devServer = process.env["ELECTRON_RENDERER_URL"];
        if (!app.isPackaged && devServer !== undefined)
          void mini.loadURL(new URL("mini.html", devServer).href);
        else void mini.loadFile(join(import.meta.dirname, "../renderer/mini.html"));
      },
      title: () => text.desktopWindow.miniPlayer,
      background: () => colours().background,
      openExternal: (url) => void shell.openExternal(url),
      quit: () => app.quit(),
    });
    // A call from the page waits for the services it needs.
    registerBridge(
      ipcMain,
      runtime,
      (event) => {
        const frame = (event as Electron.IpcMainInvokeEvent).senderFrame;
        return (
          (window !== undefined && frame === window.webContents.mainFrame) ||
          miniPlayer.trusts(frame)
        );
      },
      (mode) => {
        nativeTheme.themeSource = mode;
      },
      (on) =>
        configureAutostart(
          {
            platform: process.platform,
            config: process.env["XDG_CONFIG_HOME"] ?? join(app.getPath("home"), ".config"),
            executable:
              process.platform === "linux"
                ? (process.env["APPIMAGE"] ?? process.execPath)
                : process.execPath,
            args: app.isPackaged ? [] : [app.getAppPath()],
            setLogin: (settings) => app.setLoginItemSettings(settings),
          },
          on,
        ),
      () => system?.mediaBackend ?? (process.platform === "win32" ? "chromium" : "native"),
      createDesktopVersionHistory({
        version: app.getVersion(),
        channel: desktopBuild?.channel ?? null,
        folder: app.getPath("userData"),
      }),
      { open: miniPlayer.open, close: miniPlayer.close, showMain: showWindow },
    );
    // The queue's position and the play so far are saved before the app exits.
    let quitting = false;
    let quitReady = false;
    const closeServices = () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return Promise.race([
        runtime.dispose().catch(() => {}),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, 5_000))),
      ]).finally(() => clearTimeout(timer));
    };
    app.on("before-quit", (event) => {
      if (quitReady) return;
      event.preventDefault();
      if (quitting) return;
      quitting = true;
      system?.beginQuit();
      system?.close();
      poTokens.close();
      // Its position is saved while the Library is still open.
      miniPlayer.close();
      // Services that hang as they close don't keep a process nobody can see.
      void closeServices()
        .then(() => installUpdate?.())
        .finally(() => {
          quitReady = true;
          app.quit();
        });
    });
    createWindow(
      () => {
        // Back after five minutes away, the Library pulls; the account may have changed the theme.
        void runtime.runPromise(Effect.map(Account, (it) => it.foreground())).catch(() => {});
        void readTheme().then(
          (choice) => {
            theme = choice;
          },
          () => {},
        );
      },
      started,
      // Without its services Wave has nothing to show: it says so and quits.
      (error) => {
        if (quitting) return;
        quitting = true;
        console.error("[wave] Wave's services didn't start", error);
        dialog.showErrorBox(text.desktopWindow.startFailed, text.desktopWindow.startFailedHint);
        system?.close();
        poTokens.close();
        void closeServices().finally(() => app.exit(1));
      },
    );
    // A start that failed is told above.
    if (
      !(await started.then(
        () => true,
        () => false,
      ))
    )
      return;
    const [db, playback, yt] = await Promise.all([
      runtime.runPromise(Database),
      runtime.runPromise(Playback),
      runtime.runPromise(YtMusic),
    ]);
    recognize = await runtime.runPromise(Recognize);
    // Closed while the services started: Wave is quitting.
    if (window === undefined || quitting) return;
    // A file that won't open leaves its queue showing, stopped, as any such song does.
    playOpenedFiles = (paths) => void playback.openFiles(paths).catch(() => {});
    openedFiles.ready();
    system = installDesktopSystem({
      window,
      db,
      playback,
      yt,
      text: () => text,
      language: () => language,
      mediaAddon: process.env["WAVE_MEDIA_ADDON"] ?? join(resources, "native", "wave-media.node"),
      cache: cacheFolder("system-media"),
      show: showWindow,
      miniPlayer: () => void miniPlayer.open().catch(() => {}),
    });
  });
}
