import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

import { useScreenContent } from "@/lib/screenTiming";
import { AppearanceSettingsSection } from "@/settings/AppearanceSettingsSection";
import { holdAppliedGlass } from "@/settings/glass";
import { GlassSettingsSection } from "@/settings/GlassSettingsSection";
import { MotionSettingsSection } from "@/settings/MotionSettingsSection";
import { SettingsPageScreen } from "@/settings/SettingsPage";
import { ThemeSettingsSection } from "@/settings/ThemeSettingsSection";
import { TouchSettingsSection } from "@/settings/TouchSettingsSection";

/** Settings › Appearance: how Wave looks and responds. */
export default function AppearanceSettingsScreen() {
  useScreenContent(true);
  // The app's glass keeps what it had on arrival while the Glass settings change
  // (only the sample card redraws); leaving Appearance applies the latest.
  useFocusEffect(useCallback(() => holdAppliedGlass(), []));
  return (
    <SettingsPageScreen page="appearance">
      <AppearanceSettingsSection />
      <ThemeSettingsSection />
      <GlassSettingsSection />
      <MotionSettingsSection />
      <TouchSettingsSection />
    </SettingsPageScreen>
  );
}
