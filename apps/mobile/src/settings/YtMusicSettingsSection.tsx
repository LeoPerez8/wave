import { ytAccountView, type Catalogue, type YtAccount, type YtAccountNote } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";

import { AccountPhoto } from "./AccountPhoto";
import { ChoiceSection } from "./ChoiceRow";
import { searchOnlineChoice } from "./searchOnline";
import { SignInRows } from "./SignInRows";
import { useYtAccount } from "./ytAccount";
import { setYtMusicEnabled, useYtMusicEnabled } from "./ytMusic";

const notes = ({ settings }: Catalogue): Record<YtAccountNote, string> => ({
  optional: settings.ytMusicNote,
  expired: settings.yourYouTubeSessionEndedSoYTMusic,
  offline: settings.couldntSignInWithoutAConnection,
  failed: settings.youtubeDidntConfirmTheSigninTryAgain,
});

/** The signed-in account: its picture, name and email, and Sign Out. */
function AccountRow({ account, onSignOut }: { account: YtAccount; onSignOut: () => void }) {
  const { strings } = useLocalisation();
  return (
    <>
      <View
        accessible
        accessibilityLabel={strings.settings.signedIn(account.name, account.email)}
        className="flex-row items-center"
        style={{ minHeight: grid.row, gap: CELL * 1.5 }}
      >
        <AccountPhoto name={account.name} photoUrl={account.photoUrl} />
        <View className="flex-1 justify-center">
          <Text numberOfLines={1} className="font-sans text-body font-medium text-foreground">
            {account.name}
          </Text>
          {account.email !== null && (
            <Text numberOfLines={1} className="font-sans text-body text-secondary">
              {account.email}
            </Text>
          )}
        </View>
      </View>
      <Hairline />
      <View className="mt-4 items-start">
        <TextButton label={strings.settings.signOut} onPress={onSignOut} />
      </View>
      <Text className="font-sans text-footnote text-secondary">
        {strings.settings.searchPlaybackAndHomesMixesUseThis}
      </Text>
    </>
  );
}

/** Settings › Accounts › YT Music: whether Search also looks on YouTube Music, and the account it uses. */
export function YtMusicSettingsSection() {
  const { strings } = useLocalisation();
  const enabled = useYtMusicEnabled();
  const searchOnline = searchOnlineChoice.setting.useValue();
  const account = useYtAccount();
  const view = ytAccountView(account.state, enabled);

  return (
    <View>
      <CatalogLine className="mb-2">YT Music</CatalogLine>
      <Hairline />
      <SettingsSwitch
        label={strings.settings.useYTMusic}
        value={enabled}
        onValueChange={setYtMusicEnabled}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.searchAlsoFindsSongsOnYouTubeMusic}
      </Text>

      {enabled && (
        <View className="mt-6">
          <ChoiceSection
            choice={searchOnlineChoice}
            current={searchOnline}
            note={strings.settings.alwaysSearchOnlineOpensAlbumsAndArtists}
          />
        </View>
      )}

      {view !== null && (
        <View className="mt-6">
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
      )}
    </View>
  );
}
