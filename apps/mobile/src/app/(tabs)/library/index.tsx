import { IconChevronRight, IconMusic, IconStack2 } from "@tabler/icons-react-native";
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { EmptyState } from "@/components/EmptyState";
import { LargeTitleScreen } from "@/components/LargeTitleScreen";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { useScanState, useTrackCount } from "@/library/hooks";
import { useThemeColor } from "@/theme/useThemeColor";

/** An Apple Music–style entry row: accent icon, title, chevron. */
function LibraryRow({ title, href }: { title: string; href: "/library/songs" }) {
  const accent = useThemeColor("accent");
  const tertiary = useThemeColor("tertiary");
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="button"
        className="flex-row items-center gap-4 border-b border-separator py-3 active:opacity-60"
      >
        <IconMusic size={26} color={accent} strokeWidth={1.75} />
        <Text className="flex-1 font-sans text-title3 text-foreground">{title}</Text>
        <IconChevronRight size={20} color={tertiary} strokeWidth={2} />
      </Pressable>
    </Link>
  );
}

export default function LibraryScreen() {
  const scan = useScanState();
  const trackCount = useTrackCount();
  const empty = scan.status === "done" && trackCount === 0;

  return (
    <LargeTitleScreen title="Library">
      <ScanProgressBanner />
      {empty ? (
        <EmptyState
          icon={IconStack2}
          title="No music found"
          message="Wave didn't find any audio files in your Music folder. Copy some music there and it will show up here."
        />
      ) : (
        <View>
          <LibraryRow title="Songs" href="/library/songs" />
        </View>
      )}
    </LargeTitleScreen>
  );
}
