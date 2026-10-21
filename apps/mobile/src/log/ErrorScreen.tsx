import type { ErrorBoundaryProps } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { exportAppLog } from "./appLog";

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
 * reported the error, so it's in the app log (src/log/appLog.ts), and Export
 * Logs shares it from here. Drawn outside the app's providers, so it uses
 * nothing but React Native's own views.
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
        Wave noted what happened. Export Logs shares it as a text file.
      </Text>
      {exportFailed && (
        <Text
          accessibilityLiveRegion="polite"
          className="mt-2 font-sans text-subheadline text-secondary"
        >
          Couldn't export the logs. Try again.
        </Text>
      )}
      <View className="mt-4 flex-row flex-wrap" style={{ columnGap: 24 }}>
        <Action label="Try Again" onPress={() => void retry()} />
        <Action
          label="Export Logs"
          onPress={() => {
            setExportFailed(false);
            exportAppLog().catch((error: unknown) => {
              console.warn("[wave] Couldn't export the logs", error);
              setExportFailed(true);
            });
          }}
        />
      </View>
    </ScrollView>
  );
}
