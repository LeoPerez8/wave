import { requireNativeModule } from "expo";

import type { ProgressNoticeModule } from "./progressNotice";

/** Link imports' foreground service and notification (`PlaylistImportService`). */
export const WavePlaylistImport = requireNativeModule<
  ProgressNoticeModule & {
    /** No import is going on any more: stops the service and takes the notification away. */
    end(): void;
  }
>("WavePlaylistImport");
