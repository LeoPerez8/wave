import {
  spotifyAccountView,
  spotifySignInFailureLines,
  type Catalogue,
  type SpotifyAccount,
  type SpotifyAccountNote,
} from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";

import { AccountPhoto } from "./AccountPhoto";
import { SignInRows } from "./SignInRows";
import { useSpotifyAccount } from "./spotifyAccount";

const notes = (strings: Catalogue): Record<SpotifyAccountNote, string> => ({
  optional: strings.settings.spotifyNote,
  expired: strings.settings.spotifyEndedYourSessionSoWaveIs,
  ...spotifySignInFailureLines(strings),
});

/** The signed-in account: its photo and name, and Sign Out. */
function AccountRow({ account, onSignOut }: { account: SpotifyAccount; onSignOut: () => void }) {
  const { strings } = useLocalisation();
  return (
    <>
      <View
        accessible
        accessibilityLabel={strings.settings.spotifySignedIn(account.name)}
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
        <TextButton label={strings.settings.signOut} onPress={onSignOut} />
      </View>
      <Text className="font-sans text-footnote text-secondary">
        {strings.settings.signingOutForgetsThisAccountOnThis}
      </Text>
    </>
  );
}

/** Settings › Accounts › Spotify: the account Wave reads and shares your Spotify playlists with. */
export function SpotifySettingsSection() {
  const { strings } = useLocalisation();
  const account = useSpotifyAccount();
  const view = spotifyAccountView(account.state);

  return (
    <View>
      <CatalogLine className="mb-2">Spotify</CatalogLine>
      <Hairline />
      {view.kind === "account" ? (
        <AccountRow account={view.account} onSignOut={account.signOut} />
      ) : (
        <SignInRows
          action={view.action}
          note={notes(strings)[view.note]}
          onSignIn={account.signIn}
        />
      )}
    </View>
  );
}
