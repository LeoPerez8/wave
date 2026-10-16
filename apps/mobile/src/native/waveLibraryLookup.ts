import { requireNativeModule } from "expo";

import type { ProgressNoticeModule } from "./progressNotice";

/** The whole-Library lyrics and genre run's foreground service and notification (`LibraryLookupService`). */
export const WaveLibraryLookup = requireNativeModule<
  ProgressNoticeModule & {
    /** The run ended: stops the service; a summary (title and message) is shown in a notification. */
    end(title: string | null, message: string | null): void;
    /** Takes the summary notification away once the owner has seen the summary in Wave. */
    dismissSummary(): void;
  }
>("WaveLibraryLookup");
