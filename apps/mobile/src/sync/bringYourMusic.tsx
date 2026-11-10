import type { FirstRunAnswer } from "@wave/core";
import { IconMusic } from "@tabler/icons-react-native";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import {
  openSpotifyLibraryImport,
  openYtLibraryImport,
  type LibraryService,
} from "@/library/YtLibraryPickerHost";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { showError } from "@/overlay/alert";
import { openOverlay } from "@/overlay/overlay";
import { setYtMusicEnabled, useYtMusicEnabled } from "@/settings/ytMusic";
import { useThemeColor } from "@/theme/useThemeColor";

import { FirstRunCard } from "./FirstRunCard";

/** Source marks last for this launch; only answering the card is kept across launches. */
const importing = new Set<LibraryService>();
const importers = { spotify: openSpotifyLibraryImport, ytMusic: openYtLibraryImport };

function BringYourMusicCard({
  answer,
  importFrom,
}: {
  answer: () => void;
  importFrom: (source: LibraryService) => void;
}) {
  const { strings } = useLocalisation();
  const text = strings.settings.bringYourMusic;
  const enabled = useYtMusicEnabled();
  const ink = useThemeColor("foreground");
  return (
    <FirstRunCard
      title={text.title}
      actions={
        <>
          <TextButton label={strings.settings.signInInvitation.notNow} onPress={answer} />
          {importing.size > 0 && <TextButton label={strings.imports.continue} onPress={answer} />}
        </>
      }
    >
      <View className="flex-row items-center" style={{ gap: CELL * 2 }}>
        <IconMusic size={28} color={ink} strokeWidth={1.5} />
        <Text className="flex-1 font-sans text-subheadline text-secondary">{text.line}</Text>
      </View>
      {enabled ? (
        <View style={{ gap: CELL }}>
          {(["spotify", "ytMusic"] as const).map((source) => (
            <View key={source} className="flex-row flex-wrap items-center" style={{ gap: CELL }}>
              <TextButton
                label={
                  source === "spotify" ? strings.imports.fromSpotify : strings.imports.fromYtMusic
                }
                onPress={() => importFrom(source)}
              />
              {importing.has(source) && (
                <Text
                  accessibilityLiveRegion="polite"
                  className="font-sans text-footnote text-secondary"
                >
                  {strings.settings.importing}
                </Text>
              )}
            </View>
          ))}
        </View>
      ) : (
        <View style={{ gap: CELL }}>
          <Text className="font-sans text-footnote text-secondary">{text.needsYtMusic}</Text>
          <TextButton label={text.turnOnYtMusic} onPress={() => setYtMusicEnabled(true)} />
        </View>
      )}
    </FirstRunCard>
  );
}

/**
 * Card 1 temporarily leaves for the same sign-in and picker as Import Playlists.
 * Closing either returns it to Core as due; dismissal or Continue answers it.
 */
export const showBringYourMusic = (finished: (answer: FirstRunAnswer) => void): void => {
  let open = true;
  const finish = (answer: FirstRunAnswer): void => {
    if (!open) return;
    open = false;
    finished(answer);
  };
  const handle = openOverlay({
    label: currentLocalisation().strings.settings.bringYourMusic.title,
    onDismiss: () => finish("done"),
    render: (close) => (
      <BringYourMusicCard
        answer={() => {
          close();
          finish("done");
        }}
        importFrom={(source) => {
          if (!open) return;
          // Keep the runner showing while the card leaves for a sign-in or picker.
          open = false;
          handle.close();
          let returned = false;
          const onClosed = (imported: boolean): void => {
            if (returned) return;
            returned = true;
            if (imported) importing.add(source);
            finished("due");
          };
          void importers[source](onClosed).catch((error: unknown) => {
            showError(currentLocalisation().strings.imports.couldntImportPlaylists, error);
            onClosed(false);
          });
        }}
      />
    ),
  });
};
