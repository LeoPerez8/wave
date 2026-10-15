import { ArtistPhotosSettingsSection } from "@/settings/ArtistPhotosSettingsSection";
import { LyricsAndGenreSettingsSection } from "@/settings/LyricsAndGenreSettingsSection";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/** Settings › Lyrics and tags: the online lookups, the whole-Library run, and artist photos. */
export default function LyricsAndTagsSettingsScreen() {
  return (
    <SettingsPageScreen page="lyricsAndTags">
      <LyricsAndGenreSettingsSection />
      <ArtistPhotosSettingsSection />
    </SettingsPageScreen>
  );
}
