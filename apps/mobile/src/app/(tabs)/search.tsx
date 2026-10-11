import { IconSearch } from "@tabler/icons-react-native";

import { EmptyState } from "@/components/EmptyState";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";

export default function SearchScreen() {
  return (
    <LargeTitleScreen title="Search">
      <EmptyState
        icon={IconSearch}
        title="Search your library"
        message="Find songs, albums, artists, genres and playlists."
      />
    </LargeTitleScreen>
  );
}
