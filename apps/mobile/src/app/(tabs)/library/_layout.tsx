import { Stack } from "expo-router";

import { useThemeColor } from "@/theme/useThemeColor";

export default function LibraryLayout() {
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const accent = useThemeColor("accent");

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: background },
        headerStyle: { backgroundColor: background },
        headerShadowVisible: false,
        headerTintColor: accent,
        headerTitleStyle: { fontFamily: "Inter", fontWeight: "600", color: foreground },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false, title: "Library" }} />
      <Stack.Screen name="songs" options={{ title: "Songs" }} />
    </Stack>
  );
}
