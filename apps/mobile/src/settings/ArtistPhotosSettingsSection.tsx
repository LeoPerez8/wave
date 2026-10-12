import { Switch, Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { useArtistPhotoCount } from "@/library/artistPhotos";
import {
  clearArtistPhotoCache,
  startArtistPhotoDownloads,
  stopArtistPhotoDownloads,
} from "@/library/runtime";
import { confirmAction, showError } from "@/overlay/alert";
import { useThemeColor } from "@/theme/useThemeColor";

import { setArtistPhotosEnabled, useArtistPhotosEnabled } from "./artistPhotos";

const setDownloads = (on: boolean): void => {
  setArtistPhotosEnabled(on);
  if (on) startArtistPhotoDownloads();
  else stopArtistPhotoDownloads();
};

const confirmClear = async (count: number): Promise<void> => {
  const clear = await confirmAction({
    title: "Clear artist photos?",
    message: `The ${count === 1 ? "photo" : `${count.toLocaleString("en")} photos`} Wave downloaded will be deleted. Artists show their album artwork until photos are downloaded again.`,
    action: { label: "Clear", destructive: true },
  });
  if (clear)
    await clearArtistPhotoCache().catch((error) =>
      showError("Couldn't clear artist photos", error),
    );
};

/** Settings › Artist photos: downloading artist photos online, and clearing them. */
export function ArtistPhotosSettingsSection() {
  const enabled = useArtistPhotosEnabled();
  const count = useArtistPhotoCount();
  const accent = useThemeColor("accent");
  const fill = useThemeColor("fill");
  const surface = useThemeColor("surface");

  return (
    <>
      <CatalogLine className="mb-2 mt-12">Artist photos</CatalogLine>
      <Hairline />
      <View className="flex-row items-center" style={{ minHeight: grid.row }}>
        <Text className="flex-1 font-sans text-title3 font-normal text-foreground">
          Download artist photos
        </Text>
        <Switch
          accessibilityLabel="Download artist photos"
          value={enabled}
          onValueChange={setDownloads}
          trackColor={{ false: fill, true: accent }}
          thumbColor={surface}
        />
      </View>
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
    </>
  );
}
