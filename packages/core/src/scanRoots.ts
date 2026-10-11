/**
 * Scan roots: the folders Wave indexes. Decides what adding or removing a root
 * does to the other roots and to the indexed files, and how a root is named.
 *
 * Paths are absolute, `/`-separated, without a trailing slash.
 */

export interface ScanRootState {
  readonly path: string;
  /** Added by Wave on first launch (the shared Music folder), not picked by the owner. */
  readonly isDefault: boolean;
  readonly trackCount: number;
}

export type AddRootPlan =
  /** The folder is already indexed through `by` (itself or a parent folder). */
  | { readonly kind: "covered"; readonly by: string }
  /** Add the folder and drop the roots in `drop`, which it makes redundant. */
  | { readonly kind: "add"; readonly drop: readonly string[] };

/** Whether [path] is [folder] or inside it. */
export const isWithin = (path: string, folder: string): boolean =>
  path === folder || path.startsWith(folder === "/" ? "/" : `${folder}/`);

/**
 * Plans adding [added] as a scan root. A folder inside an existing root adds
 * nothing. Otherwise the new root replaces the roots inside it (their files
 * stay indexed) and the default Music root when that found no music, so
 * picking your own folder doesn't leave an empty default behind.
 */
export const planAddRoot = (roots: readonly ScanRootState[], added: string): AddRootPlan => {
  const parent = roots.find((root) => isWithin(added, root.path));
  if (parent !== undefined) return { kind: "covered", by: parent.path };
  return {
    kind: "add",
    drop: roots
      .filter((root) => isWithin(root.path, added) || (root.isDefault && root.trackCount === 0))
      .map((root) => root.path),
  };
};

/** The files that leave the library when [removed] stops being a root: those no remaining root covers. */
export const filesLeavingWithRoot = (
  files: readonly string[],
  removed: string,
  remaining: readonly string[],
): readonly string[] =>
  files.filter(
    (file) => isWithin(file, removed) && !remaining.some((root) => isWithin(file, root)),
  );

export type ExclusionPlan =
  /** Only folders inside a scan root can be excluded. */
  | { readonly kind: "outside" }
  /** The folder is a scan root: remove it from the music folders instead. */
  | { readonly kind: "root" }
  /** The folder is already excluded through `by` (itself or a parent folder). */
  | { readonly kind: "covered"; readonly by: string }
  /** Exclude the folder and drop the exclusions in `drop`, which it makes redundant. */
  | { readonly kind: "add"; readonly drop: readonly string[] };

/** Plans excluding [folder] from the scan [roots], given the folders already [excluded]. */
export const planExclusion = (
  roots: readonly string[],
  excluded: readonly string[],
  folder: string,
): ExclusionPlan => {
  if (roots.includes(folder)) return { kind: "root" };
  if (!roots.some((root) => isWithin(folder, root))) return { kind: "outside" };
  const parent = excluded.find((path) => isWithin(folder, path));
  if (parent !== undefined) return { kind: "covered", by: parent };
  return { kind: "add", drop: excluded.filter((path) => isWithin(path, folder)) };
};

export interface FolderLabel {
  /** The folder's own name, or the storage name for a storage root. */
  readonly name: string;
  /** "Internal storage", "SD card", or null for paths outside shared storage. */
  readonly storage: string | null;
  /** Path from the storage root, e.g. `Music/Rock`; empty for the storage root itself. */
  readonly relativePath: string;
}

const INTERNAL = /^\/storage\/emulated\/\d+(?=\/|$)/;
const REMOVABLE = /^\/storage\/[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}(?=\/|$)/;

/** How a scan root is shown: `/storage/emulated/0/Músicas` is "Músicas" on internal storage. */
export const describeFolder = (path: string): FolderLabel => {
  const internal = INTERNAL.exec(path);
  const volume = internal ?? REMOVABLE.exec(path);
  const storage = internal !== null ? "Internal storage" : volume !== null ? "SD card" : null;
  const relativePath = volume === null ? path : path.slice(volume[0].length + 1);
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  return { name: name || storage || path, storage, relativePath };
};
