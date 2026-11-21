/**
 * The Wave account in Wave's services (docs/spec-desktop.md, Wave account and sync): the
 * account (`account.ts`) and the Library's sync with it (`desktopSync.ts`), told when a scan
 * finished, a play ended or a star changed, and the invitation to sign in after the first scan.
 */
import { Database } from "@wave/client";
import {
  GENIUS_INSIGHTS_SETTING,
  LANGUAGE_PREFERENCE,
  type LanguageChoice,
  type SyncClock,
  type ThemeEdit,
  desktopBringYourMusic,
} from "@wave/core";
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
import type { LanguageView } from "../../shared/language.ts";
import { readDesktopLanguage, saveDesktopLanguage } from "../language.ts";
import { editDesktopTheme, THEME_PREFERENCE } from "../theme.ts";
import { geniusInsightsEnabled } from "../library/lyricsAndTags.ts";
import { createDesktopGenius, type DesktopGenius } from "../lyrics/genius.ts";

export interface AccountShape {
  readonly language: () => LanguageView;
  readonly setLanguage: (choice: LanguageChoice) => void;
  /** Makes [edit] to the account's theme and gives it as it is kept then. */
  readonly editTheme: (edit: ThemeEdit) => string;
  /** A synced setting was saved and stamped here: it goes up without waiting for the timed sync. */
  readonly settingsEdited: () => void;
  readonly view: () => AccountView;
  readonly genius: DesktopGenius;
  readonly signIn: () => Promise<void>;
  readonly cancelSignIn: () => void;
  readonly signOut: () => Promise<void>;
  readonly signOutEverywhere: () => Promise<void>;
  readonly deleteAccount: () => Promise<void>;
  /** Not Now or Sign In on the invitation: it never shows again. */
  readonly answerInvitation: () => void;
  /** Continue, Not Now or Escape on Bring your music: it never shows again on this computer. */
  readonly answerBringYourMusic: () => void;
  /** A Wave window got focus. */
  readonly foreground: () => void;
}

export class Account extends Context.Service<Account, AccountShape>()("@wave/desktop/Account") {}

/** The invitation's answer, kept with the desktop's own settings. */
const INVITATION = "firstRun.signInInvitation";
/** Bring your music's answer, kept on this computer and never synced: `due`, then `answered`. */
const BRING_YOUR_MUSIC = "firstRun.bringYourMusic";

export const accountLayer = (options: {
  readonly account: WaveAccountService;
  /** Whether a Wave window has focus. */
  readonly focused: () => boolean;
  /** The time and timers; the system's by default. */
  readonly clock?: SyncClock;
  readonly preferredLanguages?: () => readonly string[];
  readonly languageChanged?: (view: LanguageView) => void;
  /** The account's theme changed, here or in a pull: its stored value. */
  readonly themeChanged?: (stored: string | null) => void;
  readonly fetch?: typeof globalThis.fetch;
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
      const language = () => readDesktopLanguage(db, options.preferredLanguages?.() ?? []);
      const genius = createDesktopGenius({
        db,
        account,
        playback,
        language: () => language().language,
        fetch: options.fetch ?? globalThis.fetch,
      });
      const stopSession = account.subscribe(() => genius.cancel());
      const languageChanged = () => {
        genius.cancel();
        options.languageChanged?.(language());
      };
      languageChanged();
      const sync = createDesktopSync({
        db,
        account,
        focused: options.focused,
        // The account's Crossfade, Normalize Volume or Buffer apply from the next song, as a
        // change in Settings › Playback does.
        preferencesPulled: (keys) => {
          if (keys.includes(LANGUAGE_PREFERENCE)) languageChanged();
          if (keys.includes(THEME_PREFERENCE))
            options.themeChanged?.(syncedPreference(db, THEME_PREFERENCE));
          if (keys.includes(GENIUS_INSIGHTS_SETTING) && !geniusInsightsEnabled(db)) genius.cancel();
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
          stopSession();
          genius.cancel();
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
      /** The invitation's first answer makes Bring your music due: the card follows it. */
      const answerInvitation = (): void => {
        if (preference(db, INVITATION) !== undefined) return;
        savePreference(db, INVITATION, "answered");
        if (preference(db, BRING_YOUR_MUSIC) === undefined)
          savePreference(db, BRING_YOUR_MUSIC, "due");
      };
      return {
        genius,
        language,
        setLanguage: (choice) => {
          saveDesktopLanguage(db, choice);
          languageChanged();
          sync.edited({ songs: false });
        },
        editTheme: (edit) => {
          const stored = editDesktopTheme(db, edit);
          options.themeChanged?.(stored);
          sync.edited({ songs: false });
          return stored;
        },
        settingsEdited: () => {
          if (!geniusInsightsEnabled(db)) genius.cancel();
          sync.edited({ songs: false });
        },
        view: () => {
          const { account: view, keyringMissing, deletionSent } = account.view();
          return {
            account: view,
            keyringMissing,
            deletionSent,
            invitation:
              scanned &&
              view.kind === "signedOut" &&
              account.session().status === "signedOut" &&
              preference(db, INVITATION) === undefined,
            bringYourMusic:
              scanned && desktopBringYourMusic(preference(db, BRING_YOUR_MUSIC) ?? null) === "due",
            revision: sync.revision(),
            theme: syncedPreference(db, THEME_PREFERENCE),
            geniusInsights: geniusInsightsEnabled(db),
          };
        },
        // Signing in from Settings answers the invitation too.
        signIn: () => {
          answerInvitation();
          return account.signIn();
        },
        cancelSignIn: account.cancelSignIn,
        signOut: account.signOut,
        signOutEverywhere: account.signOutEverywhere,
        deleteAccount: account.deleteAccount,
        answerInvitation,
        answerBringYourMusic: () => savePreference(db, BRING_YOUR_MUSIC, "answered"),
        foreground: sync.foreground,
      };
    }),
  );
