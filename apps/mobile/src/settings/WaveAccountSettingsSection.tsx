import { waveAccountView, type WaveAccount, type WaveAccountNote } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";

import { AccountPhoto } from "./AccountPhoto";
import { WAVE_ACCOUNT_CONFIG, useWaveAccount } from "./waveAccount";

const NOTES: Record<WaveAccountNote, string> = {
  about:
    "Optional. Keeps your song list, playlists, favorites, play history and preferences, so " +
    "another phone signed in gets them back.",
  ended: "Your Wave session ended, so this phone is signed out. Sign in again to keep your backup.",
  deleted: "Your Wave account was deleted. Everything on this phone stays.",
  offline: "Couldn't sign in without a connection.",
  noGoogleAccount: "Add a Google account to this phone in Android's settings, then sign in.",
  notAllowed: "This Google account can't use Wave's server.",
  failed: "Couldn't sign in. Try again.",
};

const SIGN_IN_LABELS = {
  signIn: "Sign In with Google",
  signInAgain: "Sign In Again",
  signingIn: "Signing In…",
} as const;

const DELETE_NOTES = {
  offline: "Couldn't delete the account without a connection.",
  failed: "Wave's server didn't delete the account. Try again.",
} as const;

/** The signed-in account: its picture, name and email, Sign Out and Delete Account. */
function AccountRow({
  account,
  busy,
  note,
  onSignOut,
  onDelete,
}: {
  account: WaveAccount;
  busy: "signingOut" | "deleting" | null;
  note: keyof typeof DELETE_NOTES | null;
  onSignOut: () => void;
  onDelete: () => void;
}) {
  const name = account.name ?? account.email;
  return (
    <>
      <View
        accessible
        accessibilityLabel={`Signed in as ${name}`}
        className="flex-row items-center"
        style={{ minHeight: grid.row, gap: CELL * 1.5 }}
      >
        <AccountPhoto name={name} photoUrl={account.photoUrl} />
        <View className="flex-1 justify-center">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {name}
          </Text>
          {account.name !== null && (
            <Text numberOfLines={1} className="font-sans text-body text-secondary">
              {account.email}
            </Text>
          )}
        </View>
      </View>
      <Hairline />
      <View className="mt-4 flex-row items-center" style={{ gap: CELL * 3 }}>
        <TextButton
          label={busy === "signingOut" ? "Signing Out…" : "Sign Out"}
          disabled={busy !== null}
          onPress={onSignOut}
        />
        <TextButton
          label={busy === "deleting" ? "Deleting…" : "Delete Account"}
          tone="destructive"
          disabled={busy !== null}
          onPress={onDelete}
        />
      </View>
      <Text className="font-sans text-footnote text-secondary">
        {note === null
          ? "Signing out keeps everything on this phone. Deleting the account deletes what " +
            "Wave's server has of it, not what's on this phone."
          : DELETE_NOTES[note]}
      </Text>
    </>
  );
}

/** Settings › Wave Account: signing in with Google, signing out and deleting the account. */
export function WaveAccountSettingsSection() {
  const account = useWaveAccount();
  const view = waveAccountView(account.state, WAVE_ACCOUNT_CONFIG !== null);

  return (
    <>
      <CatalogLine className="mb-2 mt-12">Wave Account</CatalogLine>
      <Hairline />
      {view.kind === "account" ? (
        <AccountRow
          account={view.account}
          busy={view.busy}
          note={view.note}
          onSignOut={account.signOut}
          onDelete={account.deleteAccount}
        />
      ) : view.kind === "signedOut" ? (
        <>
          <View className="items-start" style={{ minHeight: grid.row, justifyContent: "center" }}>
            <TextButton
              label={SIGN_IN_LABELS[view.action]}
              disabled={view.action === "signingIn"}
              onPress={account.signIn}
            />
          </View>
          <Hairline />
          <Text className="mt-2 font-sans text-footnote text-secondary">{NOTES[view.note]}</Text>
        </>
      ) : (
        <Text className="mt-2 font-sans text-footnote text-secondary">
          Wave accounts aren't set up on this build, so there's nothing to sign in to.
        </Text>
      )}
    </>
  );
}
