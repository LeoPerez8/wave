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
  const [exportFailed, setExportFailed] = useState(false);
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}
    >
      <Text className="font-sans text-title3 font-normal text-foreground">
        Something went wrong
      </Text>
      <Text className="mt-2 font-sans text-subheadline text-secondary">
        Wave noted what happened. Save Logs keeps it in Downloads/Wave. Send to Leo shares it with
        him.
      </Text>
      {exportFailed && (
        <Text
          accessibilityLiveRegion="polite"
          className="mt-2 font-sans text-subheadline text-secondary"
        >
          Couldn't send the logs. Try again.
        </Text>
      )}
      <View className="mt-4 flex-row flex-wrap" style={{ columnGap: 24 }}>
        <Action label="Try Again" onPress={() => void retry()} />
        <Action
          label="Save Logs"
          onPress={() => {
            saveAppLog().then(
              () => ToastAndroid.show("Saved to Downloads/Wave", ToastAndroid.LONG),
              (error: unknown) => {
                console.warn("[wave] Couldn't save the logs", error);
                ToastAndroid.show("Couldn't save the logs", ToastAndroid.LONG);
              },
            );
          }}
        />
        <Action
          label="Send to Leo"
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
