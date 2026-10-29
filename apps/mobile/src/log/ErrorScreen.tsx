import { useLocalisation } from "@/localisation/localisation";
import type { ErrorBoundaryProps } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, ToastAndroid, View } from "react-native";

import { exportAppLog, saveAppLog } from "./appLog";

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="justify-center"
      style={{ minHeight: 48, minWidth: 48 }}
    >
      <Text className="font-sans text-body font-medium text-accent">{label}</Text>
    </Pressable>
  );
}

/**
 * What Wave shows when the app fails to render, instead of closing: React has
 * reported the error, so it's in the app log (src/log/appLog.ts). Save Logs works
 * here too, and Send to Leo shares the log as Developer's Export Logs does. Drawn
 * outside the app's providers, so it uses nothing but React Native's own views.
 */
export function ErrorScreen({ retry }: ErrorBoundaryProps) {
  const { strings } = useLocalisation();
  const [exportFailed, setExportFailed] = useState(false);
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}
    >
      <Text className="font-sans text-title3 font-normal text-foreground">
        {strings.settings.somethingWentWrong}
      </Text>
      <Text className="mt-2 font-sans text-subheadline text-secondary">
        {strings.settings.waveNotedWhatHappenedSaveLogsKeeps}
      </Text>
      {exportFailed && (
        <Text
          accessibilityLiveRegion="polite"
          className="mt-2 font-sans text-subheadline text-secondary"
        >
          {strings.settings.couldntSendTheLogsTryAgain}
        </Text>
      )}
      <View className="mt-4 flex-row flex-wrap" style={{ columnGap: 24 }}>
        <Action label={strings.settings.tryAgain} onPress={() => void retry()} />
        <Action
          label={strings.settings.saveLogs}
          onPress={() => {
            saveAppLog().then(
              () => ToastAndroid.show(strings.settings.savedToDownloadsWave, ToastAndroid.LONG),
              (error: unknown) => {
                console.warn("[wave] Couldn't save the logs", error);
                ToastAndroid.show(strings.settings.couldntSaveTheLogs, ToastAndroid.LONG);
              },
            );
          }}
        />
        <Action
          label={strings.settings.sendToLeo}
          onPress={() => {
            setExportFailed(false);
            exportAppLog().catch((error: unknown) => {
              console.warn("[wave] Couldn't send the logs", error);
              setExportFailed(true);
            });
          }}
        />
      </View>
    </ScrollView>
  );
}
