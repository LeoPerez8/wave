import { IconHome, IconSearch, IconStack2 } from "@tabler/icons-react-native";
import { Tabs } from "expo-router";

import { useThemeColor } from "@/theme/useThemeColor";

// Plain tab bar for now; the glass tab bar with Search as a separate pill
// replaces it once the glass spike has picked a technique.
export default function TabsLayout() {
  const accent = useThemeColor("accent");
  const secondary = useThemeColor("secondary");
  const surface = useThemeColor("surface");
  const separator = useThemeColor("separator");

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: secondary,
        tabBarStyle: { backgroundColor: surface, borderTopColor: separator },
        tabBarLabelStyle: { fontFamily: "Inter", fontSize: 10, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <IconHome color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarIcon: ({ color, size }) => <IconStack2 color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, size }) => <IconSearch color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
