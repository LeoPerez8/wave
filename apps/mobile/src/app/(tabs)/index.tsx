import { IconMusic } from "@tabler/icons-react-native";
import { Link } from "expo-router";
import { Pressable, Text } from "react-native";

import { EmptyState } from "@/components/EmptyState";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";

export default function HomeScreen() {
  return (
    <LargeTitleScreen title="Home">
      <EmptyState
        icon={IconMusic}
        title="Nothing played yet"
        message="Your recently added, recently played and most played music will show up here."
      />
      {/* Temporary entry to the glass spike (#4); removed once a technique is chosen. */}
      <Link href="/dev/glass" asChild>
        <Pressable className="mt-12 self-center py-2">
          <Text className="font-sans text-footnote text-tertiary">Developer: glass spike</Text>
        </Pressable>
      </Link>
    </LargeTitleScreen>
  );
}
