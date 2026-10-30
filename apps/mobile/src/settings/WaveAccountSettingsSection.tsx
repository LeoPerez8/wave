import {
  missingSongsDownloadActionLabels,
  waveAccountView,
  type Catalogue,
  ytSongArtist,
  type WaveAccount,
  type WaveAccountNote,
} from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";
import { runMissingSongsDownloadAction, useMissingSongsDownload } from "@/ytmusic/YtDownloads";

import { AccountPhoto } from "./AccountPhoto";
import { WAVE_ACCOUNT_CONFIG, useWaveAccount } from "./waveAccount";

const notes = ({ settings }: Catalogue): Record<WaveAccountNote, string> => ({
  about: settings.waveAccountNote,
  ended: settings.yourWaveSessionEndedSoThisPhone,
  deleted: settings.yourWaveAccountWasDeletedEverythingOn,
  offline: settings.couldntSignInWithoutAConnection,
  noGoogleAccount: settings.addAGoogleAccountToThisPhone,
  notAllowed: settings.thisGoogleAccountCantUseWavesServer,
  failed: settings.couldntSignInTryAgain,
});

const signInLabels = ({ settings }: Catalogue) => ({
  signIn: settings.signInWithGoogle,
  signInAgain: settings.signInAgain,
  signingIn: settings.signingIn,
});

type DeleteNote = "offline" | "failed";

const deleteNotes = ({ settings }: Catalogue): Record<DeleteNote, string> => ({
  offline: settings.couldntDeleteTheAccountWithoutAConnection,
  failed: settings.wavesServerDidntDeleteTheAccountTry,
});

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
  note: DeleteNote | null;
  onSignOut: () => void;
  onDelete: () => void;
}) {
  const { strings } = useLocalisation();
  const name = account.name ?? account.email;
  return (
    <>
      <View
        accessible
        accessibilityLabel={strings.settings.signedIn(
          name,
          account.name === null ? null : account.email,
        )}
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
      <View className="mt-4 flex-row flex-wrap items-center" style={{ columnGap: CELL * 3 }}>
        <TextButton
          label={busy === "signingOut" ? strings.settings.signingOut : strings.settings.signOut}
          disabled={busy !== null}
          onPress={onSignOut}
        />
        <TextButton
          label={busy === "deleting" ? strings.settings.deleting : strings.settings.deleteAccount}
          tone="destructive"
          disabled={busy !== null}
          onPress={onDelete}
        />
      </View>
      <Text accessibilityLiveRegion="polite" className="font-sans text-footnote text-secondary">
        {note === null ? strings.settings.waveAccountSignOutNote : deleteNotes(strings)[note]}
      </Text>
    </>
  );
}

/**
 * The account's songs this phone has no file for: how many, or how far their
 * download is, with Download All, Retry Failed and Cancel (Core's
 * `missingSongsDownload`), then the songs nothing matched, which stay missing.
 */
function MissingSongsDownloadRows() {
  const { strings } = useLocalisation();
  const { line, actions, summary } = useMissingSongsDownload();
  if (line === null && summary === null) return null;
  return (
    <View className="mt-6">
      <Hairline />
      {line !== null && (
        <View className="justify-center" style={{ minHeight: grid.row }}>
          <Text className="font-sans text-body text-foreground">{line}</Text>
        </View>
      )}
      {actions.length > 0 && (
        <View className="flex-row flex-wrap items-center" style={{ columnGap: CELL * 3 }}>
          {actions.map((action) => (
            <TextButton
              key={action}
              label={missingSongsDownloadActionLabels(strings)[action]}
              onPress={() => runMissingSongsDownloadAction(action)}
            />
          ))}
        </View>
      )}
      {summary !== null && (
        <View className="mt-2">
          <Text className="font-sans text-footnote text-secondary">{summary.line}</Text>
          {summary.songs.map((song) => (
            <Text
              key={song.videoId}
              numberOfLines={1}
              className="font-sans text-footnote text-secondary"
            >
              {`${song.title} · ${ytSongArtist(song)}`}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Settings › Accounts › Wave Account: signing in with Google, signing out and deleting
 * the account, and downloading the songs this phone has no file for.
 */
export function WaveAccountSettingsSection() {
  const { strings } = useLocalisation();
  const account = useWaveAccount();
  const view = waveAccountView(account.state, WAVE_ACCOUNT_CONFIG !== null);

  return (
    <View>
      <CatalogLine className="mb-2">{strings.settings.waveAccount}</CatalogLine>
      <Hairline />
      {view.kind === "account" ? (
        <>
          <AccountRow
            account={view.account}
            busy={view.busy}
            note={view.note}
            onSignOut={account.signOut}
            onDelete={account.deleteAccount}
          />
          <MissingSongsDownloadRows />
        </>
      ) : view.kind === "signedOut" ? (
        <>
          <View className="items-start justify-center" style={{ minHeight: grid.row }}>
            <TextButton
              label={signInLabels(strings)[view.action]}
              disabled={view.action === "signingIn"}
              onPress={account.signIn}
            />
          </View>
          <Hairline />
          <Text
            accessibilityLiveRegion="polite"
            className="mt-2 font-sans text-footnote text-secondary"
          >
            {notes(strings)[view.note]}
          </Text>
        </>
      ) : (
        <Text className="mt-2 font-sans text-footnote text-secondary">
          {strings.settings.waveAccountsArentSetUpOnThis}
        </Text>
      )}
    </View>
  );
}
