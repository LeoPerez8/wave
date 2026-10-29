import { formatNumber } from "@wave/core";
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
    title: "Clear artist photos?",
    message: `The ${count === 1 ? "photo" : `${formatNumber(currentLocalisation().language, count)} photos`} Wave downloaded will be deleted. Artists show their album artwork until photos are downloaded again.`,
    action: { label: "Clear", destructive: true },
  });
  if (clear)
    await clearArtistPhotoCache().catch((error) =>
      showError("Couldn't clear artist photos", error),
    );
};

/** Settings › Lyrics and tags › Artist photos: downloading artist photos online, and clearing them. */
export function ArtistPhotosSettingsSection() {
  const enabled = useArtistPhotosEnabled();
  const count = useArtistPhotoCount();

  return (
    <View>
      <CatalogLine className="mb-2">Artist photos</CatalogLine>
      <Hairline />
      <SettingsSwitch label="Download artist photos" value={enabled} onValueChange={setDownloads} />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Wave looks up a photo of each artist on Deezer, which means sending artist names to it, and
        keeps the photos on your phone. Off, artists show their album artwork and Wave makes no
        requests.
      </Text>
      <View className="mt-4 items-start">
        <TextButton
          label="Clear artist photos"
          tone="destructive"
          disabled={count === 0}
          onPress={() => void confirmClear(count)}
        />
      </View>
    </View>
  );
}
