import { IconStack2 } from "@tabler/icons-react-native";

import { EmptyState } from "@/components/EmptyState";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";

export default function LibraryScreen() {
  return (
    <LargeTitleScreen title="Library">
      <EmptyState
        icon={IconStack2}
        title="No music yet"
        message="Songs from your Music folder will appear here once Wave can scan your library."
      />
    </LargeTitleScreen>
  );
}
