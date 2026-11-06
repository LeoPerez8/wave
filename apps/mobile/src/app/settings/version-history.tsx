import { versionHistoryEntries, type VersionHistoryEntry } from "@wave/core";
import { useEffect } from "react";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { useScreenContent } from "@/lib/screenTiming";
import { useLocalisation } from "@/localisation/localisation";
import { SettingsPageScreen } from "@/settings/SettingsPage";
import { RUNNING_VERSION } from "@/updates/runningVersion";
import {
  VERSION_HISTORY_CHANNEL,
  useVersionHistory,
  versionHistory,
} from "@/updates/versionHistory";

/** One release: its version (with "Current" on the running one), its date, then its lines. */
function Release({ entry }: { entry: VersionHistoryEntry }) {
  const { strings } = useLocalisation();
  const version = strings.appUpdates.version(entry.version);
  return (
    <View style={{ gap: CELL }}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={[
          version,
          entry.current ? strings.versionHistory.current : null,
          entry.date,
        ]
          .filter((part) => part !== null)
          .join(", ")}
      >
        <View className="flex-row items-baseline" style={{ gap: CELL }}>
          <Text className="font-sans text-title3 text-foreground" selectable>
            {version}
          </Text>
          {entry.current && (
            <Text className="font-sans text-footnote font-semibold text-accent">
              {strings.versionHistory.current}
            </Text>
          )}
        </View>
        {entry.date !== null && (
          <Text className="font-sans text-footnote text-secondary">{entry.date}</Text>
        )}
      </View>
      {entry.sections.map(({ title, lines }) => (
        <View key={title} style={{ gap: CELL / 2, paddingTop: CELL }}>
          <Text className="font-sans text-footnote font-semibold text-secondary">{title}</Text>
          {lines.map((line) => (
            <Text key={line} className="font-sans text-body text-foreground">
              {line}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Settings › Version History: the channel's releases newest first, as Core's
 * `versionHistoryEntries` lays them out. It opens with the last list read,
 * kept on the phone, and reads the history again; that list stays while it
 * does and when the read fails, so "Couldn't load" shows only with nothing kept.
 */
export default function VersionHistoryScreen() {
  const { language, strings } = useLocalisation();
  const { status, releases } = useVersionHistory();
  useScreenContent(true);
  useEffect(() => versionHistory.load(), []);

  const entries =
    releases === null
      ? null
      : versionHistoryEntries({
          releases,
          runningVersion: RUNNING_VERSION,
          channel: VERSION_HISTORY_CHANNEL,
          language,
        });
  const failed = status === "failed" && (entries === null || entries.length === 0);

  return (
    <SettingsPageScreen page="versionHistory">
      {failed ? (
        <View style={{ paddingTop: CELL * 3 }}>
          <Text className="font-sans text-body text-secondary">
            {strings.versionHistory.failed}
          </Text>
          <TextButton
            variant="plain"
            label={strings.versionHistory.tryAgain}
            onPress={versionHistory.load}
          />
        </View>
      ) : entries !== null && entries.length === 0 && status !== "loading" ? (
        <Text className="font-sans text-body text-secondary" style={{ paddingTop: CELL * 3 }}>
          {strings.versionHistory.empty}
        </Text>
      ) : (
        (entries ?? []).map((entry) => <Release key={entry.version} entry={entry} />)
      )}
    </SettingsPageScreen>
  );
}
