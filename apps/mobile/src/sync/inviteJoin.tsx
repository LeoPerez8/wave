/**
 * An invite link opened in Wave (docs/spec.md › Collaborative playlists, Invite link): the join
 * screen, the sign-in prompt and the messages that keep someone out (`openInvite` decides which).
 * The token goes to the service only in a request body, and is never logged.
 */
import { inviteToken, type InviteJoinView } from "@wave/core";
import { IconUsers } from "@tabler/icons-react-native";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { currentLocalisation } from "@/localisation/localisation";
import { LibraryStore } from "@/library/LibraryStore";
import { onPlaylistsEdited } from "@/library/playlists";
import { openPlaylist } from "@/library/routes";
import { appRuntime } from "@/library/runtime";
import { WaveAccount } from "@/native/waveAccount";
import { confirmAction, showMessage } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { dismissAllOverlays, presentOverlay } from "@/overlay/overlay";
import { showToast } from "@/overlay/toast";
import { signInWaveAccount, waveSyncUrl } from "@/settings/waveAccount";
import { useThemeColor } from "@/theme/useThemeColor";

import { collaborations } from "./collaborations";
import { openInvite, openWhenJoined } from "./inviteJoinRunner";
import { syncNow } from "./startSync";

/** How long after Join the playlist is opened when a sync brings it. */
const OPEN_WITHIN_MS = 60_000;

/** Mock screen 7: who invited, to which playlist, what joining allows, Join, Cancel, and who joins. */
function JoinCard({ view, finish }: { view: InviteJoinView; finish: (join: boolean) => void }) {
  const [fill, secondary] = useThemeColor(["fill", "secondary"]);
  return (
    <>
      <CardEntries>
        <View className="items-center" style={{ gap: CELL, paddingTop: CELL * 2 }}>
          <View
            className="items-center justify-center"
            style={{
              width: 120,
              height: 120,
              borderRadius: 10,
              backgroundColor: fill,
              marginBottom: CELL,
            }}
          >
            <IconUsers size={48} color={secondary} strokeWidth={1.5} />
          </View>
          <Text className="text-center font-sans text-subheadline text-secondary">
            {view.invitedBy}
          </Text>
          <Text
            accessibilityRole="header"
            className="text-center font-sans text-title3 font-semibold text-foreground"
          >
            {view.playlistName}
          </Text>
          <Text
            className="text-center font-sans text-subheadline text-secondary"
            style={{ marginBottom: CELL }}
          >
            {view.allows}
          </Text>
        </View>
      </CardEntries>
      <View style={{ gap: CELL }}>
        <TextButton
          label={view.join}
          variant="pill"
          selected
          onPress={() => finish(true)}
          className="items-center"
        />
        <TextButton
          label={view.cancel}
          variant="pill"
          onPress={() => finish(false)}
          className="items-center"
        />
        <Text
          className="text-center font-sans text-footnote text-secondary"
          style={{ paddingTop: CELL }}
        >
          {view.joiningAs}
        </Text>
      </View>
    </>
  );
}

/**
 * After Join: the playlist opens at once when the device already has it, else when a sync
 * brings it within a minute (`openWhenJoined`). The toast says it joined meanwhile.
 */
const joined = (playlistId: string, view: InviteJoinView): void => {
  void showToast(currentLocalisation().strings.inviteJoin.joined(view.playlistName));
  openWhenJoined(
    {
      find: () =>
        appRuntime
          // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
          .runPromise(LibraryStore.use((store) => store.joinedPlaylistId(playlistId))),
      onPlaylistsEdited,
      open: (id) => openPlaylist(id),
      after: (ms, done) => {
        const timer = setTimeout(done, ms);
        return () => clearTimeout(timer);
      },
    },
    OPEN_WITHIN_MS,
  );
  syncNow();
};

/**
 * Opens [text] when it holds an invite link of this build's sync service (a tapped link or a
 * share): true when it did, so nothing else handles it.
 */
export const openInviteLink = (text: string): boolean => {
  const token = waveSyncUrl === null ? null : inviteToken(text, waveSyncUrl);
  if (token === null) return false;
  dismissAllOverlays();
  void openInvite(token, {
    session: () => WaveAccount.session(),
    language: () => currentLocalisation().language,
    askSignIn: (prompt) =>
      confirmAction({
        title: prompt.title,
        message: prompt.message,
        action: { label: prompt.signIn },
      }),
    signIn: () => signInWaveAccount(),
    lookUp: (sent) => collaborations.lookUpInvite(sent),
    askJoin: (view) =>
      presentOverlay<boolean>({
        label: view.playlistName,
        dismissed: false,
        render: (finish) => <JoinCard view={view} finish={finish} />,
      }),
    join: (sent) => collaborations.join(sent),
    notify: (notice) => showMessage(notice.title, notice.message),
    joined,
  }).catch(() => {});
  return true;
};
