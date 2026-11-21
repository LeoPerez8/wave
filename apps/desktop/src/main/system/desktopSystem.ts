import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, dialog, Menu, Tray, type BrowserWindow } from "electron";
import type { LibraryDatabase } from "@wave/client/db/database";
import { displayTag, type AppLanguage, type Catalogue } from "@wave/core";
import type { PlaybackShape } from "../playback/playback.ts";
import type { YtMusicShape } from "../yt/ytMusic.ts";
import { readArtwork } from "../library/artwork.ts";
import { preference, savePreference } from "../preferences.ts";
import { createWindowLifecycle } from "./windowLifecycle.ts";
import { readWindowSettings } from "./windowSettings.ts";
import { createMediaIntegration, type MediaCommand, type MediaView } from "./media.ts";
import { trayIcon } from "./trayIcon.ts";

interface NativeMedia {
  readonly metadata: (
    title: string,
    artist: string,
    album: string,
    cover: string,
    duration: number,
  ) => void;
  readonly playback: (state: string, position: number) => void;
  readonly drain: () => MediaCommand[];
  readonly close: () => void;
}

/** Platform glue only: playback and all queue decisions remain in Playback / @wave/client. */
export const installDesktopSystem = (options: {
  readonly window: BrowserWindow;
  readonly db: LibraryDatabase;
  readonly playback: PlaybackShape;
  readonly yt: YtMusicShape;
  readonly text: () => Catalogue;
  readonly language: () => AppLanguage;
  readonly mediaAddon: string;
  readonly cache: string;
  readonly show: () => void;
  /** Opens the floating mini player. */
  readonly miniPlayer: () => void;
}) => {
  const { window, db, playback } = options;
  const lifecycle = createWindowLifecycle({
    visible: () => window.isVisible() && !window.isMinimized(),
    hide: () => window.hide(),
    show: options.show,
    quit: () => app.quit(),
    closeQuits: () => readWindowSettings(db).closeQuits,
    noticed: () => preference(db, "window.trayNotice") === "true",
    rememberNotice: () => savePreference(db, "window.trayNotice", "true"),
    notice: () => {
      const text = options.text();
      return dialog.showMessageBox({
        type: "info",
        title: text.desktopWindow.notice,
        message:
          process.platform === "linux"
            ? text.desktopWindow.noticeLinux
            : text.desktopWindow.noticeWindows,
        buttons: [text.alert.ok],
      });
    },
  });
  window.on("close", lifecycle.close);
  let tray: Tray | undefined;
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip(options.text().desktopLayout.brand);
    tray.on("click", lifecycle.toggle);
  } catch {
    console.warn("[system] Tray unavailable; launch Wave again or use MPRIS Raise.");
  }

  let native: NativeMedia | undefined;
  let mediaBackend: "native" | "chromium" = "chromium";
  // The Windows SMTC probe failed to deliver Souvlaki commands (#1157); Chromium is its
  // specified fallback. Linux uses Souvlaki's MPRIS, including Raise without a tray.
  if (process.platform !== "win32")
    try {
      const addon = createRequire(import.meta.url)(options.mediaAddon) as {
        SystemMedia: new () => NativeMedia;
      };
      native = new addon.SystemMedia();
      mediaBackend = "native";
    } catch (error) {
      console.warn(
        "[system] Media controls unavailable",
        error instanceof Error ? error.message : "",
      );
    }

  let coverUrl: string | null = null;
  const mediaView = (): MediaView => {
    const { current, status } = playback.view();
    return {
      state: status.state,
      positionMs: status.positionMs,
      durationMs: status.durationMs ?? current?.durationMs ?? 0,
      song: current
        ? {
            key: status.key ?? String(current.videoId ?? current.id),
            title: current.title,
            artist: displayTag(current.artist, "artist", options.language()),
            album: displayTag(current.album, "album", options.language()),
            coverUrl,
          }
        : null,
    };
  };
  const media = createMediaIntegration({
    view: mediaView,
    play: playback.play,
    pause: playback.pause,
    skip: (type) => playback.command({ type }),
    seek: playback.seek,
    show: options.show,
    quit: () => app.quit(),
    publish: (view) => native?.playback(view.state, view.positionMs),
  });
  let closed = false;
  let lastMenu = "";
  let lastSong = "";
  let artworkRevision = 0;
  let slot = 0;
  let lastMetadata = "";
  const failed = () => console.warn("[system] Media command failed.");
  const run = (command: MediaCommand) => void media.command(command).catch(failed);
  const fileUrl = (path: string) =>
    process.platform === "win32" ? `file://${path}` : pathToFileURL(path).href;
  const refresh = () => {
    if (closed) return;
    const { current, status } = playback.view();
    const signature = JSON.stringify([
      status.key,
      current?.id,
      current?.videoId,
      current?.title,
      current?.artist,
      current?.album,
      current?.artworkHash,
      current?.artworkUrl,
    ]);
    if (native && signature !== lastSong) {
      lastSong = signature;
      coverUrl = null;
      const revision = ++artworkRevision;
      // Only the current cover is read. Two alternating files bound this OS thumbnail cache.
      void (async () => {
        const encoded = current?.artworkHash
          ? await readArtwork(db, current.artworkHash, false)
          : current?.artworkUrl
            ? await options.yt.artwork(current.artworkUrl)
            : null;
        if (closed || revision !== artworkRevision) return;
        await mkdir(options.cache, { recursive: true });
        const file = join(options.cache, `cover-${(slot = 1 - slot)}.png`);
        const bytes = encoded
          ? Buffer.from(encoded.slice(encoded.indexOf(",") + 1), "base64")
          : trayIcon().toPNG();
        await writeFile(file, bytes);
        if (closed || revision !== artworkRevision) return;
        coverUrl = fileUrl(file);
      })().catch(failed);
    }
    const view = mediaView();
    const metadata = JSON.stringify([view.song, view.durationMs]);
    if (coverUrl && metadata !== lastMetadata) {
      native?.metadata(
        view.song?.title ?? "",
        view.song?.artist ?? "",
        view.song?.album ?? "",
        coverUrl,
        view.durationMs,
      );
      lastMetadata = metadata;
    }
    media.update();
    for (const command of native?.drain() ?? []) run(command);
  };
  // The tray menu is rebuilt apart from the media controls, so a failing system media service
  // (no session bus, a broken MPRIS host) can't leave the tray stale or in the wrong language.
  const refreshTray = () => {
    if (closed) return;
    const text = options.text();
    const { current, status } = playback.view();
    const artist = current ? displayTag(current.artist, "artist", options.language()) : "";
    const menuKey = JSON.stringify([current?.title, artist, status.state, options.language()]);
    if (tray && menuKey !== lastMenu) {
      lastMenu = menuKey;
      const labels = text.desktopLayout;
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: current ? `${current.title} · ${artist}` : labels.nothingPlaying,
            enabled: false,
          },
          { type: "separator" },
          {
            label: status.state === "playing" ? labels.pause : labels.play,
            enabled: !!current,
            click: () => run({ action: "toggle" }),
          },
          { label: labels.next, enabled: !!current, click: () => run({ action: "next" }) },
          { label: labels.previous, enabled: !!current, click: () => run({ action: "previous" }) },
          { type: "separator" },
          { label: text.desktopWindow.show, click: options.show },
          { label: text.desktopWindow.miniPlayer, click: options.miniPlayer },
          { label: text.desktopWindow.quit, click: () => app.quit() },
        ]),
      );
    }
  };
  // OS controls stay active while the window is hidden. No renderer work is needed.
  const tick = () => {
    try {
      refresh();
    } catch {
      failed();
    }
    try {
      refreshTray();
    } catch {
      console.warn("[system] Tray menu update failed.");
    }
  };
  const timer = setInterval(tick, 500);
  tick();
  return {
    mediaBackend,
    beginQuit: lifecycle.beginQuit,
    close: () => {
      closed = true;
      clearInterval(timer);
      window.removeListener("close", lifecycle.close);
      tray?.destroy();
      native?.close();
    },
  };
};
