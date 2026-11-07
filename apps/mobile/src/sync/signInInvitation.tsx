/**
 * First run's invitation to sign in to a Wave account (docs/spec.md, Wave account and sync, "The
 * invitation"): once, on a new install, after the all-files access screen. Core's
 * `nextFirstRunStep` decides when; Not Now, a tap outside, Back and Sign In with Google each answer
 * it for good. Wave works fully without it.
 */
import { waveAccountView } from "@wave/core";
import { IconDevices, IconMessageCircle, IconTicket, type Icon } from "@tabler/icons-react-native";
import { Storage } from "expo-sqlite/kv-store";
import { useEffect } from "react";
import { AppState, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { WaveNative } from "@/native/waveNative";
import { isNowPlayingShown, onNowPlayingShownChange } from "@/nowPlaying/sheet";
import { CardEntries } from "@/overlay/CardEntries";
import { isOverlayOpen, onOverlaysChange, openOverlay } from "@/overlay/overlay";
import { WAVE_ACCOUNT_CONFIG, useWaveAccount } from "@/settings/waveAccount";
import { waveAccountNotes, waveSignInLabels } from "@/settings/WaveAccountSettingsSection";
import { useThemeColor } from "@/theme/useThemeColor";

import { createSignInInvitationRunner } from "./signInInvitationRunner";
import { onWaveSignedInChange, waveSignedInNow } from "./waveSignedIn";

/** "due" or "done"; nothing until the first launch that had the invitation. */
const INVITATION_KEY = "firstRun.signInInvitation";

/**
 * Kept by every phone that has used Wave: the version What's New last dealt with, and the card
 * before a first Wave account sign-in.
 */
const USED_BEFORE_KEYS = ["updates.seenVersion", "waveAccount.cardSeen"] as const;

/** One thing an account brings: its glyph, a short title and a line under it. */
function Unlock({ icon: Glyph, title, line }: { icon: Icon; title: string; line: string }) {
  const ink = useThemeColor("foreground");
  return (
    <View className="flex-row" style={{ gap: CELL * 2 }}>
      <View style={{ paddingTop: 1 }}>
        <Glyph size={28} color={ink} strokeWidth={1.5} />
      </View>
      <View className="flex-1">
        <Text className="font-sans text-body font-medium text-foreground">{title}</Text>
        <Text className="font-sans text-subheadline text-secondary">{line}</Text>
      </View>
    </View>
  );
}

/**
 * What a Wave account unlocks, then Not Now and Sign In with Google. Signing in from here is
 * Settings' Sign In: the card about what goes up comes first, and a refusal says why under the
 * list. A sign-in that works closes it.
 */
function SignInInvitationCard({ close, answered }: { close: () => void; answered: () => void }) {
  const { strings } = useLocalisation();
  const text = strings.settings.signInInvitation;
  const account = useWaveAccount();
  const view = waveAccountView(account.state, WAVE_ACCOUNT_CONFIG !== null);
  const signedIn = view.kind === "account";

  useEffect(() => {
    if (signedIn) close();
  }, [signedIn, close]);

  const note =
    view.kind === "signedOut" && view.note !== "about"
      ? waveAccountNotes(strings)[view.note]
      : text.note;

  return (
    <>
      <CardEntries>
        <View style={{ gap: CELL * 3, paddingTop: CELL, paddingBottom: CELL * 3 }}>
          <Text
            accessibilityRole="header"
            className="font-sans text-title2 font-light text-foreground"
            style={{ letterSpacing: -0.3 }}
          >
            {text.title}
          </Text>
          <Unlock icon={IconDevices} title={text.libraryTitle} line={text.library} />
          <Unlock icon={IconMessageCircle} title={text.geniusTitle} line={text.genius} />
          <Unlock icon={IconTicket} title={text.showsTitle} line={text.shows} />
          <Text accessibilityLiveRegion="polite" className="font-sans text-footnote text-secondary">
            {note}
          </Text>
        </View>
      </CardEntries>
      <View className="flex-row flex-wrap items-center justify-end" style={{ columnGap: CELL * 3 }}>
        <TextButton
          label={text.notNow}
          onPress={() => {
            close();
            answered();
          }}
        />
        <TextButton
          label={
            view.kind === "signedOut"
              ? waveSignInLabels(strings)[view.action]
              : strings.settings.signInWithGoogle
          }
          disabled={view.kind === "signedOut" && view.action === "signingIn"}
          onPress={() => {
            answered();
            account.signIn();
          }}
        />
      </View>
    </>
  );
}

let runner: ReturnType<typeof createSignInInvitationRunner> | null = null;
let following = false;
const stops: (() => void)[] = [];

const stopFollowing = (): void => {
  for (const stop of stops.splice(0)) stop();
};

/**
 * Settles, once per JS runtime, whether this phone is a new install. Call it as the app opens,
 * before the access screen can be passed: only a new install opens without access.
 */
export const settleSignInInvitation = (): void => {
  runner ??= createSignInInvitationRunner({
    stored: {
      get: () => Storage.getItemSync(INVITATION_KEY),
      set: (value) => Storage.setItemSync(INVITATION_KEY, value),
    },
    accessGrantedAtLaunch: WaveNative.hasAllFilesAccess(),
    usedBefore: USED_BEFORE_KEYS.some((key) => Storage.getItemSync(key) !== null),
    surroundings: () => ({
      accessGranted: WaveNative.hasAllFilesAccess(),
      accountAvailable: WAVE_ACCOUNT_CONFIG !== null,
      signedIn: waveSignedInNow(),
      visible: AppState.currentState === "active",
      nowPlayingShown: isNowPlayingShown(),
      cardOpen: isOverlayOpen(),
    }),
    show: (answered) => {
      let open = true;
      const answer = (): void => {
        if (!open) return;
        open = false;
        answered();
      };
      openOverlay({
        label: currentLocalisation().strings.settings.signInInvitation.title,
        onDismiss: answer,
        render: (close) => <SignInInvitationCard close={close} answered={answer} />,
      });
    },
    onFinished: stopFollowing,
  });
};

/**
 * Once Wave holds access, follows the phone until the invitation shows and is answered, or
 * isn't due: it waits for Now Playing, another card or the background.
 */
export const startSignInInvitation = (): void => {
  settleSignInInvitation();
  // A phone that answered it, or used Wave before it, follows nothing.
  if (following || runner === null || !runner.isDue()) return;
  following = true;
  const appState = AppState.addEventListener("change", runner.reconsider);
  stops.push(
    () => appState.remove(),
    onNowPlayingShownChange(runner.reconsider),
    onOverlaysChange(runner.reconsider),
    onWaveSignedInChange(runner.reconsider),
  );
  runner.reconsider();
};
