import type { LauncherIcon } from "@wave/core";

/**
 * The activity alias that shows `icon` in the launcher, without the package
 * (`dev.leoperez.wave.LauncherIcon_teal_ember`). The config plugin declares
 * one per icon (`plugins/launcherIcons.ts`) and Settings turns one on.
 */
export const launcherAlias = (icon: Pick<LauncherIcon, "id">): string => `LauncherIcon_${icon.id}`;
