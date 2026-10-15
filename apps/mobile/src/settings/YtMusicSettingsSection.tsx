import { ytAccountView, type YtAccount, type YtAccountNote } from "@wave/core";
import { Switch, Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { useThemeColor } from "@/theme/useThemeColor";

import { AccountPhoto } from "./AccountPhoto";
import { useYtAccount } from "./ytAccount";
import { setYtMusicEnabled, useYtMusicEnabled } from "./ytMusic";

const NOTES: Record<YtAccountNote, string> = {
  optional:
    "Signing in is optional. Signed in, Search, playback and Discover use your " +
    "account. The session stays on this phone. With Download in best quality off, or when Soulseek " +
    "can't deliver a song, downloads come from YouTube Music: AAC at 256 kbps with Premium, " +
    "about 128 kbps without.",
  expired:
    "Your YouTube session ended, so YT Music is signed out. Sign in again to use your account.",
  offline: "Couldn't sign in without a connection.",
  failed: "YouTube didn't confirm the sign-in. Try again.",
};

const SIGN_IN_LABELS = {
  signIn: "Sign In",
  signInAgain: "Sign In Again",
  signingIn: "Signing In…",
} as const;

/** The signed-in account: its picture, name and email, and Sign Out. */
function AccountRow({ account, onSignOut }: { account: YtAccount; onSignOut: () => void }) {
  return (
    <>
      <View
        accessible
        accessibilityLabel={`Signed in as ${account.name}`}
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
        <TextButton label="Sign Out" onPress={onSignOut} />
      </View>
      <Text className="font-sans text-footnote text-secondary">
        Search, playback and Discover use this account. Signing out forgets it on this phone.
      </Text>
    </>
  );
}

/** Settings › YT Music: whether Search also looks on YouTube Music, and the account it uses. */
export function YtMusicSettingsSection() {
  const enabled = useYtMusicEnabled();
  const account = useYtAccount();
  const view = ytAccountView(account.state, enabled);
  const accent = useThemeColor("accent");
  const fill = useThemeColor("fill");
  const surface = useThemeColor("surface");

  return (
    <>
      <CatalogLine className="mb-2 mt-12">YT Music</CatalogLine>
      <Hairline />
      <View className="flex-row items-center" style={{ minHeight: grid.row }}>
        <Text className="flex-1 font-sans text-title3 font-normal text-foreground">
          Use YT Music
        </Text>
        <Switch
          accessibilityLabel="Use YT Music"
          value={enabled}
          onValueChange={setYtMusicEnabled}
          trackColor={{ false: fill, true: accent }}
          thumbColor={surface}
        />
      </View>
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Search also finds songs on YouTube Music, which means sending what you type to YouTube.
        Nothing from your library is sent. Off, Wave makes no YT Music requests.
      </Text>

      {view !== null && (
        <View className="mt-6">
          <Hairline />
          {view.kind === "account" ? (
            <AccountRow account={view.account} onSignOut={account.signOut} />
          ) : (
            <>
              <View
                className="items-start"
                style={{ minHeight: grid.row, justifyContent: "center" }}
              >
                <TextButton
                  label={SIGN_IN_LABELS[view.action]}
                  disabled={view.action === "signingIn"}
                  onPress={account.signIn}
                />
              </View>
              <Hairline />
              <Text className="mt-2 font-sans text-footnote text-secondary">
                {NOTES[view.note]}
              </Text>
            </>
          )}
        </View>
      )}
    </>
  );
}
