/** Desktop folder settings use Core's phone rules with Windows path identity. */
import { planAddRoot, planExclusion, scanPath, scanPathKey, scanPathWithin } from "@wave/core";
import { eq, inArray, sql } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { addRoot, addExcludedFolder, excludedFolders } from "./libraryQueries.ts";
import { creditSplits } from "./credits.ts";
import { leaveFiles } from "./missingSongs.ts";
import { pruneOrphans } from "./save.ts";
import { tracks, scanRoots, excludedFolders as exclusions } from "./schema.ts";

export const desktopRoots = (db: LibraryDatabase, platform: string) => {
  const prefix = sql`rtrim(${scanRoots.path}, '/') || '/'`;
  const beginning = sql`substr(${tracks.path}, 1, length(${prefix}))`;
  const under =
    platform === "win32"
      ? sql`lower(${beginning}) = lower(${prefix})`
      : sql`${beginning} = ${prefix}`;
  return db
    .select({
      path: scanRoots.path,
      isDefault: scanRoots.isDefault,
      trackCount: sql<number>`(SELECT count(*) FROM ${tracks} WHERE ${under})`,
    })
    .from(scanRoots)
    .orderBy(scanRoots.addedAt, scanRoots.path)
    .all();
};

export const desktopFolders = (db: LibraryDatabase, platform: string) => {
  const key = (path: string) => scanPathKey(path, platform);
  return {
    add: (path: string) => {
      const roots = desktopRoots(db, platform);
      const plan = planAddRoot(
        roots.map((root) => ({ ...root, path: key(root.path) })),
        key(path),
      );
      if (plan.kind === "add")
        addRoot(
          db,
          scanPath(path, platform),
          roots.filter((root) => plan.drop.includes(key(root.path))).map((root) => root.path),
        );
    },
    exclude: (path: string) => {
      const roots = desktopRoots(db, platform);
      const existing = excludedFolders(db);
      const plan = planExclusion(
        roots.map((root) => key(root.path)),
        existing.map(key),
        key(path),
      );
      if (plan.kind === "outside" || plan.kind === "root")
        throw new Error(`Cannot exclude folder: ${plan.kind}`);
      if (plan.kind === "add")
        addExcludedFolder(
          db,
          scanPath(path, platform),
          existing.filter((folder) => plan.drop.includes(key(folder))),
        );
    },
    include: (path: string) => {
      const existing = excludedFolders(db).find((folder) => key(folder) === key(path));
      if (existing !== undefined) db.delete(exclusions).where(eq(exclusions.path, existing)).run();
    },
    remove: (path: string) => {
      const roots = desktopRoots(db, platform);
      const removed = roots.find((root) => key(root.path) === key(path));
      if (removed === undefined) return;
      if (roots.length <= 1) throw new Error("Wave needs at least one music folder");
      const remaining = roots.filter((root) => root !== removed);
      const leaving = (file: string) =>
        scanPathWithin(file, removed.path, platform) &&
        !remaining.some((root) => scanPathWithin(file, root.path, platform));
      db.transaction((tx) => {
        const paths = tx
          .select({ path: tracks.path })
          .from(tracks)
          .all()
          .flatMap((row) => (row.path !== null && leaving(row.path) ? [row.path] : []));
        leaveFiles(tx, paths, Date.now());
        tx.delete(scanRoots).where(eq(scanRoots.path, removed.path)).run();
        const stale = excludedFolders(tx).filter(leaving);
        if (stale.length > 0) tx.delete(exclusions).where(inArray(exclusions.path, stale)).run();
        pruneOrphans(tx, creditSplits());
      });
    },
  };
};
