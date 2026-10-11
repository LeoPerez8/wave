import { IconMusic } from "@tabler/icons-react-native";

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
    </LargeTitleScreen>
  );
}
