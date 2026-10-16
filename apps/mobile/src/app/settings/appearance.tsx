import { AppearanceSettingsSection } from "@/settings/AppearanceSettingsSection";
import { GlassSettingsSection } from "@/settings/GlassSettingsSection";
import { MotionSettingsSection } from "@/settings/MotionSettingsSection";
import { SettingsPageScreen } from "@/settings/SettingsPage";
import { ShortcutTabSettingsSection } from "@/settings/ShortcutTabSettingsSection";
import { ThemeSettingsSection } from "@/settings/ThemeSettingsSection";
import { TouchSettingsSection } from "@/settings/TouchSettingsSection";

/** Settings › Appearance: how Wave looks and responds, and its shortcut tab. */
export default function AppearanceSettingsScreen() {
  return (
    <SettingsPageScreen page="appearance">
      <AppearanceSettingsSection />
      <ThemeSettingsSection />
      <GlassSettingsSection />
      <MotionSettingsSection />
      <TouchSettingsSection />
      <ShortcutTabSettingsSection />
    </SettingsPageScreen>
  );
}
