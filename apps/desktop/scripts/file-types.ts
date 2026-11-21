/**
 * The file types Wave offers to open (docs/spec-desktop.md, Opening files): what the Windows
 * installer registers and what the AppImage's desktop entry declares. Wave becomes an "Open
 * with" choice; it never takes a type's default from another player.
 */
import { PLAYABLE_EXTENSIONS } from "../src/shared/playback.ts";

/** Every extension the engine plays except MP4, which is a video more often than a song. */
export const OPEN_WITH_EXTENSIONS: readonly string[] = PLAYABLE_EXTENSIONS.filter(
  (extension) => extension !== "mp4",
);

/** Wave's file class in the Windows registry, the same for every audio type. */
const PROG_ID = "Wave.AudioFile";

/**
 * The NSIS include electron-builder runs inside the installer and the uninstaller. Installing
 * adds Wave to each extension's "Open with" list (`OpenWithProgids`) and says which types the
 * program opens (`Applications\Wave.exe\SupportedTypes`); the extension's own default value,
 * which names the program a double-click starts, is left alone. Uninstalling removes only
 * what was added. The installer is per user, so everything is under HKCU.
 */
export const windowsOpenWithScript = (): string => {
  const classes = "Software\\Classes";
  const application = `${classes}\\Applications\\\${APP_EXECUTABLE_FILENAME}`;
  const command = `'"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" "%1"'`;
  const refresh = "System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'";
  return [
    "!macro customInstall",
    `  WriteRegStr HKCU "${classes}\\${PROG_ID}\\DefaultIcon" "" "$INSTDIR\\\${APP_EXECUTABLE_FILENAME},0"`,
    `  WriteRegStr HKCU "${classes}\\${PROG_ID}\\shell\\open\\command" "" ${command}`,
    `  WriteRegStr HKCU "${application}\\shell\\open\\command" "" ${command}`,
    ...OPEN_WITH_EXTENSIONS.flatMap((extension) => [
      `  WriteRegStr HKCU "${application}\\SupportedTypes" ".${extension}" ""`,
      `  WriteRegStr HKCU "${classes}\\.${extension}\\OpenWithProgids" "${PROG_ID}" ""`,
    ]),
    `  ${refresh}`,
    "!macroend",
    "",
    "!macro customUnInstall",
    ...OPEN_WITH_EXTENSIONS.map(
      (extension) =>
        `  DeleteRegValue HKCU "${classes}\\.${extension}\\OpenWithProgids" "${PROG_ID}"`,
    ),
    `  DeleteRegKey HKCU "${classes}\\${PROG_ID}"`,
    `  DeleteRegKey HKCU "${application}"`,
    `  ${refresh}`,
    "!macroend",
    "",
  ].join("\n");
};

/** Each extension's types: the one the system's MIME database gives it first, then aliases. */
const MIME_TYPES: Readonly<Record<string, readonly string[]>> = {
  mp3: ["audio/mpeg", "audio/mp3"],
  m4a: ["audio/mp4", "audio/x-m4a"],
  flac: ["audio/flac", "audio/x-flac"],
  ogg: ["audio/x-vorbis+ogg", "audio/ogg"],
  oga: ["audio/ogg"],
  opus: ["audio/x-opus+ogg", "audio/opus"],
  wav: ["audio/x-wav", "audio/wav", "audio/vnd.wave"],
};

/** The `MimeType` of the AppImage's desktop entry (electron-builder's `linux.mimeTypes`). */
export const LINUX_MIME_TYPES: string[] = [
  ...new Set(
    OPEN_WITH_EXTENSIONS.flatMap((extension) => {
      const types = MIME_TYPES[extension];
      if (types === undefined) throw new Error(`No MIME type for .${extension}`);
      return types;
    }),
  ),
];
