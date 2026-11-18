/**
 * The Wave account in Wave's services (docs/spec-desktop.md, Wave account and sync): the
 * account (`account.ts`) and the Library's sync with it (`desktopSync.ts`), told when a scan
 * finished, a play ended or a star changed, and the invitation to sign in after the first scan.
 */
import { Database } from "@wave/client";
import type { SyncClock } from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { AccountView } from "../../shared/account.ts";
import { Downloads } from "../downloads/downloadsLayer.ts";
import { DesktopLibrary } from "../library/library.ts";
import { Playback } from "../playback/playback.ts";
import { changesPlaybackSettings } from "../playback/playbackSettings.ts";
import { preference, savePreference } from "../preferences.ts";
import { createDesktopSync, syncedPreference } from "../sync/desktopSync.ts";
import type { WaveAccountService } from "./account.ts";

export interface AccountShape {
  readonly view: () => AccountView;
  readonly signIn: () => Promise<void>;
  readonly cancelSignIn: () => void;
  readonly signOut: () => Promise<void>;
  readonly signOutEverywhere: () => Promise<void>;
  /** Not Now or Sign In on the invitation: it never shows again. */
  readonly answerInvitation: () => void;
  /** A Wave window got focus. */
  readonly foreground: () => void;
}

export class Account extends Context.Service<Account, AccountShape>()("@wave/desktop/Account") {}

/** The invitation's answer, kept with the desktop's own settings. */
const INVITATION = "firstRun.signInInvitation";

export const accountLayer = (options: {
  readonly account: WaveAccountService;
  /** Whether a Wave window has focus. */
  readonly focused: () => boolean;
  /** The time and timers; the system's by default. */
  readonly clock?: SyncClock;
}) =>
  Layer.effect(
    Account,
    Effect.gen(function* () {
      const db = yield* Database;
      const library = yield* DesktopLibrary;
      const playback = yield* Playback;
      const downloads = yield* Downloads;
      // A star means downloaded: a missing song's star, set here or pulled, asks for its file.
      const syncStars = () =>
        void downloads
          .syncStars()
          .catch((error: unknown) => console.warn("[wave] The stars' downloads failed", error));
      const { account } = options;
      const sync = createDesktopSync({
        db,
        account,
        focused: options.focused,
        // The account's Crossfade, Normalize Volume or Buffer apply from the next song, as a
        // change in Settings › Playback does.
        preferencesPulled: (keys) => {
          if (changesPlaybackSettings(keys))
            playback
              .applySettings()
              .catch((error: unknown) =>
                console.warn("[wave] The account's playback settings didn't apply", error),
              );
        },
        starsPulled: syncStars,
        ...(options.clock === undefined ? {} : { clock: options.clock }),
      });
      // A scan that ended before this layer was built counts as the first.
      let scanned = library.status().status === "done";
      const stopScans = library.subscribe(() => {
        scanned = true;
        sync.edited({ songs: true });
      });
      const stopPlayback = playback.subscribe((change) => {
        if (change === "played") sync.played("ended");
        else {
          sync.edited({ songs: false });
          syncStars();
        }
      });
      sync.start();
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          stopScans();
          stopPlayback();
          sync.dispose();
          // A sync running as Wave quits gets a moment to finish before the Library closes.
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            sync.idle(),
            new Promise((resolve) => (timer = setTimeout(resolve, 2_000))),
          ]);
          clearTimeout(timer);
        }),
      );
      return {
        view: () => {
          const { account: view, keyringMissing } = account.view();
          return {
            account: view,
            keyringMissing,
            invitation:
              scanned &&
              view.kind === "signedOut" &&
              account.session().status === "signedOut" &&
              preference(db, INVITATION) === undefined,
            revision: sync.revision(),
            theme: syncedPreference(db, "settings.theme"),
          };
        },
        // Signing in from Settings answers the invitation too.
        signIn: () => {
          savePreference(db, INVITATION, "answered");
          return account.signIn();
        },
        cancelSignIn: account.cancelSignIn,
        signOut: account.signOut,
        signOutEverywhere: account.signOutEverywhere,
        answerInvitation: () => savePreference(db, INVITATION, "answered"),
        foreground: sync.foreground,
      };
    }),
  );
