import {
  SPOTIFY_SIGN_IN_FAILURE_LINES,
  spotifyAccountView,
  type SpotifyAccount,
  type SpotifyAccountNote,
} from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";

import { AccountPhoto } from "./AccountPhoto";
import { useSpotifyAccount } from "./spotifyAccount";

const NOTES: Record<SpotifyAccountNote, string> = {
  optional:
    "Signing in lets Wave read your Spotify playlists and share yours there. Sign in with " +
    "your email and password or an emailed code: Continue with Google may not work here. " +
    "The session stays on this phone, and Wave talks to Spotify the way its web player does.",
  expired: "Spotify ended your session, so Wave is signed out. Sign in again to use your account.",
  ...SPOTIFY_SIGN_IN_FAILURE_LINES,
};

const SIGN_IN_LABELS = {
  signIn: "Sign In",
  signInAgain: "Sign In Again",
  signingIn: "Signing In…",
} as const;

/** The signed-in account: its photo and name, and Sign Out. */
function AccountRow({ account, onSignOut }: { account: SpotifyAccount; onSignOut: () => void }) {
  return (
    <>
      <View
        accessible
        accessibilityLabel={`Signed in to Spotify as ${account.name}`}
        className="flex-row items-center"
        style={{ minHeight: grid.row, gap: CELL * 1.5 }}
      >
        <AccountPhoto name={account.name} photoUrl={account.photoUrl} />
        <Text numberOfLines={1} className="flex-1 font-sans text-body font-medium text-foreground">
          {account.name}
        </Text>
      </View>
      <Hairline />
      <View className="mt-4 items-start">
        <TextButton label="Sign Out" onPress={onSignOut} />
      </View>
      <Text className="font-sans text-footnote text-secondary">
        Signing out forgets this account on this phone.
      </Text>
    </>
  );
}

/** Settings › Accounts › Spotify: the account Wave reads and shares your Spotify playlists with. */
export function SpotifySettingsSection() {
  const account = useSpotifyAccount();
  const view = spotifyAccountView(account.state);

  return (
    <View>
      <CatalogLine className="mb-2">Spotify</CatalogLine>
      <Hairline />
      {view.kind === "account" ? (
        <AccountRow account={view.account} onSignOut={account.signOut} />
      ) : (
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
      )}
    </View>
  );
}
