// Which apps a worktree's changes reach, so scripts/install-for.sh installs, and
// scripts/merge-ticket.sh typechecks, each of them:
//   <paths, one per line> | node scripts/ci/worktree-apps.ts   # prints mobile and/or desktop
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { changes } from "./changes.ts";

export type WorktreeApp = "mobile" | "desktop";

// The phone shares the theme's colours with the desktop (apps/mobile/global.css).
const PHONE_EXTRA = ["packages/theme/"];

/**
 * The apps a change reaches. What both apps are built from (Core, the client, the theme, the
 * shared Kotlin, the workspace and lockfile, the TypeScript base config, CI) reaches both. With
 * neither reached (docs, the sync Worker) it is the phone, the default app.
 */
export const worktreeApps = (paths: readonly string[]): WorktreeApp[] => {
  const touched = changes(paths);
  const mobile =
    touched.app ||
    touched.core ||
    touched.allPackages ||
    paths.some(
      (path) => !path.endsWith(".md") && PHONE_EXTRA.some((prefix) => path.startsWith(prefix)),
    );
  const desktop = touched.desktop || touched.allPackages;
  if (!mobile && !desktop) return ["mobile"];
  return [...(mobile ? ["mobile" as const] : []), ...(desktop ? ["desktop" as const] : [])];
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
  for (const app of worktreeApps(paths)) console.log(app);
}
