import { useLocalisation } from "@/localisation/localisation";
import { currentLocalisation } from "@/localisation/localisation";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { TextButton } from "@/components/TextButton";
import { useArtistPhotoCount } from "@/library/artistPhotos";
import {
  clearArtistPhotoCache,
  startArtistPhotoDownloads,
  stopArtistPhotoDownloads,
} from "@/library/runtime";
import { confirmAction, showError } from "@/overlay/alert";

import { setArtistPhotosEnabled, useArtistPhotosEnabled } from "./artistPhotos";

const setDownloads = (on: boolean): void => {
  setArtistPhotosEnabled(on);
  if (on) startArtistPhotoDownloads();
  else stopArtistPhotoDownloads();
};

const confirmClear = async (count: number): Promise<void> => {
  const clear = await confirmAction({
    title: currentLocalisation().strings.settings.clearArtistPhotos,
    message: currentLocalisation().strings.settings.clearPhotos(count),
    action: { label: currentLocalisation().strings.settings.clear, destructive: true },
  });
  if (clear)
    await clearArtistPhotoCache().catch((error) =>
      showError(currentLocalisation().strings.settings.couldntClearArtistPhotos, error),
    );
};

/** Settings › Lyrics and tags › Artist photos: downloading artist photos online, and clearing them. */
export function ArtistPhotosSettingsSection() {
  const { strings } = useLocalisation();
  const enabled = useArtistPhotosEnabled();
  const count = useArtistPhotoCount();

  return (
    <View>
      <CatalogLine className="mb-2">{strings.settings.artistPhotos}</CatalogLine>
      <Hairline />
      <SettingsSwitch
        label={strings.settings.downloadArtistPhotos}
        value={enabled}
        onValueChange={setDownloads}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.waveLooksUpAPhotoOfEach}
      </Text>
      <View className="mt-4 items-start">
        <TextButton
          label={strings.settings.clearArtistPhotosText}
          tone="destructive"
          disabled={count === 0}
          onPress={() => void confirmClear(count)}
        />
      </View>
    </View>
  );
}
