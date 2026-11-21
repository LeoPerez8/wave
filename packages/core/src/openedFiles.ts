/**
 * Files opened with Wave on the desktop ("Open with", a double-click, a path on the command
 * line): which of a launch's arguments are audio files, and what they queue as.
 */

/** The file's name, after the last slash of either kind. */
const fileName = (path: string): string => path.slice(path.search(/[^\\/]*$/));

/**
 * The audio files among a launch's arguments, in the order given: a path whose extension is one
 * of [extensions] (lower case, no dot). Switches, folders and any other file are ignored.
 */
export const openedAudioFiles = (
  args: readonly string[],
  extensions: readonly string[],
): string[] =>
  args.filter((arg) => {
    if (arg.startsWith("-")) return false;
    const name = fileName(arg);
    const dot = name.lastIndexOf(".");
    return dot > 0 && extensions.includes(name.slice(dot + 1).toLowerCase());
  });

const FILE_PREFIX = "file:";

/**
 * The queue id of a file outside the Library. It is neither a Library id nor a YT Music song's
 * (`parseTrackId` gives null), so its plays aren't counted and nothing about it syncs.
 */
export const openedFileTrackId = (path: string): string => `${FILE_PREFIX}${path}`;

/** The file a queue id stands for, or null when the id isn't a file's. */
export const openedFilePath = (trackId: string): string | null =>
  trackId.startsWith(FILE_PREFIX) && trackId.length > FILE_PREFIX.length
    ? trackId.slice(FILE_PREFIX.length)
    : null;

/** What a file outside the Library is called while its tags give no title: its name, no extension. */
export const openedFileTitle = (path: string): string => {
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

/**
 * The queue that opening [paths] plays, in their order: a file the Library has plays as its
 * song ([librarySong] gives its id), so its play counts; any other plays as the file itself.
 */
export const openedFilesQueue = (
  paths: readonly string[],
  librarySong: (path: string) => number | null,
): string[] =>
  paths.map((path) => {
    const id = librarySong(path);
    return id === null ? openedFileTrackId(path) : String(id);
  });
