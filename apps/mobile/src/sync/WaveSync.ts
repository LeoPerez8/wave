import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import { lazyService } from "@/lib/lazyService";

import type { SyncedChanges, SyncPreferences } from "./syncCycle";
import { make } from "./waveSyncLive";

/** What syncing needs from the app that only the app (not a headless start) has. */
export interface WaveSyncPorts {
  /** The synced preferences' values (`syncedPreferences`). */
  readonly preferences: SyncPreferences;
  /** Hears what each sync changed on the phone, to show it. */
  readonly pulled: (changes: SyncedChanges) => void;
  /**
   * Follows the Wave account's Soulseek account after each pull, natively
   * (`WaveSoulseek.followWaveAccount`): JS never sees its credentials. Then
   * Download in best quality's switch settles with its synced copy
   * (`followPulledBestQuality`), even when the first part failed.
   */
  readonly soulseek: () => Promise<unknown>;
}

/**
 * Syncs the Library with the Wave account while signed in, with no button
 * (docs/spec.md, "When it talks to the service"): an edit goes up a few
 * seconds after it's made, play ends in batches (`syncTriggers`), and the
 * account is pulled when Wave opens, when it comes back to the foreground
 * after a while and after each push. Offline, changes
 * wait in the store. A sync that fails tries again at the next of those, and
 * never reaches the Library. Signing out stops it; signing in again joins
 * the Library with the account as the first time does.
 */
export class WaveSync extends Context.Service<
  WaveSync,
  {
    /** Starts syncing while signed in (the app, not a headless start). Safe to call repeatedly. */
    readonly start: (ports: WaveSyncPorts) => Effect.Effect<void>;
    /**
     * Something changed in the Library here: it goes up a few seconds after
     * the last change. [songs]: the song list may have changed (a scan, a download).
     */
    readonly changed: (what: { readonly songs: boolean }) => Effect.Effect<void>;
    /** A play started or ended here: its play goes up in the next batch of play ends. */
    readonly played: (step: "started" | "ended") => Effect.Effect<void>;
  }
>()("@wave/mobile/sync/WaveSync") {}

/** Built on first use (`lazyService`); signed out, it never makes its sync triggers. */
export const layer = lazyService(WaveSync, () => make);
