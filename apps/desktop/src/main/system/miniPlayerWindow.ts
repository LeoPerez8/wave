/** Electron's side of the mini player: a small frameless window above the others. */
import { BrowserWindow, screen, type WebFrameMain } from "electron";
import type { LibraryDatabase } from "@wave/client/db/database";
import { desktopKey, type ScreenArea } from "@wave/core";
import { preference, savePreference } from "../preferences.ts";
import { guardWindow, windowWebPreferences } from "../security.ts";
import {
  MINI_PLAYER_POSITION,
  MINI_PLAYER_SIZE,
  createMiniPlayer,
  type MiniPlayer,
} from "./miniPlayer.ts";

/** Every screen's usable area, the primary one first. */
const screenAreas = (): ScreenArea[] => {
  const primary = screen.getPrimaryDisplay().id;
  return screen
    .getAllDisplays()
    .toSorted((a, b) => Number(b.id === primary) - Number(a.id === primary))
    .map((display) => display.workArea);
};

export const installMiniPlayer = (options: {
  /** The Library's database, once the services are up. */
  readonly db: () => Promise<LibraryDatabase>;
  readonly preload: string;
  /** Loads the mini player's page into its window. */
  readonly load: (window: BrowserWindow) => void;
  readonly title: () => string;
  readonly background: () => string;
  readonly openExternal: (url: string) => void;
  readonly quit: () => void;
}) => {
  let window: BrowserWindow | undefined;
  let player: MiniPlayer | undefined;
  const start = (db: LibraryDatabase) =>
    createMiniPlayer({
      areas: screenAreas,
      stored: () => preference(db, MINI_PLAYER_POSITION),
      store: (value) => {
        try {
          savePreference(db, MINI_PLAYER_POSITION, value);
        } catch {
          // Wave is quitting and the Library is closed: the last saved position stays.
        }
      },
      onScreensChanged: (listener) => {
        screen.on("display-removed", listener);
        screen.on("display-added", listener);
        screen.on("display-metrics-changed", listener);
      },
      create: (position) => {
        const created = new BrowserWindow({
          ...MINI_PLAYER_SIZE,
          ...position,
          show: false,
          frame: false,
          resizable: false,
          maximizable: false,
          minimizable: false,
          fullscreenable: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          backgroundColor: options.background(),
          title: options.title(),
          webPreferences: windowWebPreferences(options.preload),
        });
        // Above full-screen apps' ordinary windows too, as a floating player is.
        created.setAlwaysOnTop(true, "floating");
        guardWindow(created.webContents, options.openExternal);
        // The page's own title is the app's; this window keeps the catalogue's name.
        created.on("page-title-updated", (event) => event.preventDefault());
        // Ctrl+Q quits from here as from the main window.
        created.webContents.on("before-input-event", (event, input) => {
          if (
            input.type === "keyDown" &&
            desktopKey(
              { key: input.key, ctrl: input.control, alt: input.alt, shift: input.shift },
              "other",
            ) === "quit"
          ) {
            event.preventDefault();
            options.quit();
          }
        });
        created.on("closed", () => {
          if (window === created) window = undefined;
        });
        options.load(created);
        window = created;
        return {
          focus: () => {
            created.show();
            created.focus();
          },
          close: () => created.close(),
          position: () => {
            const [x = 0, y = 0] = created.getPosition();
            return { x, y };
          },
          move: ({ x, y }) => created.setPosition(x, y),
          on: (event, listener) => {
            // Each of the three names one of the window's events.
            created.on(event as "closed", listener);
          },
        };
      },
    });
  return {
    open: async () => {
      player ??= start(await options.db());
      player.open();
    },
    close: () => player?.close(),
    /** Whether [frame] is the mini player's page, whose bridge calls main answers. */
    trusts: (frame: WebFrameMain | null) =>
      window !== undefined && !window.isDestroyed() && frame === window.webContents.mainFrame,
  };
};
