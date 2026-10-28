import { useScreenContent } from "@/lib/screenTiming";
import { ArtistPhotosSettingsSection } from "@/settings/ArtistPhotosSettingsSection";
import { GeniusSettingsSection } from "@/settings/GeniusSettingsSection";
import { LyricsAndGenreSettingsSection } from "@/settings/LyricsAndGenreSettingsSection";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/** Settings › Lyrics and tags: the online lookups, the whole-Library run, Genius insights and artist photos. */
export default function LyricsAndTagsSettingsScreen() {
  useScreenContent(true);
  return (
    <SettingsPageScreen page="lyricsAndTags">
      <LyricsAndGenreSettingsSection />
      <GeniusSettingsSection />
      <ArtistPhotosSettingsSection />
    </SettingsPageScreen>
  );
}
