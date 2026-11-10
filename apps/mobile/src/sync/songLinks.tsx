import { songLinkHandlingLine, type FirstRunAnswer } from "@wave/core";
import { AppState, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { WaveNative } from "@/native/waveNative";
import { CardEntries } from "@/overlay/CardEntries";
import { openOverlay } from "@/overlay/overlay";
import { showToast } from "@/overlay/toast";
import {
  openAppLinkSettings,
  readSongLinkSetup,
  useSongLinkSetup,
} from "@/settings/songLinkHandling";

import { createSongLinksRunner } from "./songLinksRunner";

function SongLinksCard({ answer, turnOn }: { answer: () => void; turnOn: () => void }) {
  const { strings } = useLocalisation();
  const text = strings.settings.songLinksCard;
  // Re-read on return from another app's Open by default page, so its step goes once it's off.
  const turnOff = useSongLinkSetup()?.turnOff ?? [];
  return (
    <>
      <CardEntries>
        <View style={{ gap: CELL * 3, paddingTop: CELL, paddingBottom: CELL * 3 }}>
          <Text
            accessibilityRole="header"
            className="font-sans text-title2 font-light text-foreground"
            style={{ letterSpacing: -0.3 }}
          >
            {strings.settings.openSongLinksInWave}
          </Text>
          {turnOff.map((step) => (
            <View key={step.service} className="items-start" style={{ gap: CELL }}>
              <Text className="font-sans text-subheadline text-secondary">{step.step}</Text>
              <TextButton
                label={step.button}
                onPress={() => openAppLinkSettings(step.packageName)}
              />
            </View>
          ))}
          <Text className="font-sans text-subheadline text-secondary">{text.line}</Text>
          <View style={{ gap: CELL * 2 }}>
            {text.steps.map((step, index) => (
              <View key={step} className="flex-row" style={{ gap: CELL * 2 }}>
                <Text className="font-sans text-body font-medium text-foreground">
                  {index + 1}.
                </Text>
                <Text className="flex-1 font-sans text-body text-foreground">{step}</Text>
              </View>
            ))}
          </View>
        </View>
      </CardEntries>
      <View className="flex-row flex-wrap items-center justify-end" style={{ columnGap: CELL * 3 }}>
        <TextButton label={strings.settings.signInInvitation.notNow} onPress={answer} />
        <TextButton label={text.turnOn} onPress={turnOn} />
      </View>
    </>
  );
}

/** Card 2 shares Settings' Android page and result line; every exit answers it. */
export const showSongLinks = (finished: (answer: FirstRunAnswer) => void): void => {
  const visit = createSongLinksRunner({
    openSettings: async () => {
      if (!WaveNative.openLinkSettings) throw new Error("Song-link settings unavailable");
      await WaveNative.openLinkSettings();
    },
    subscribeVisibility: (changed) => {
      const subscription = AppState.addEventListener("change", (state) =>
        changed(state === "active"),
      );
      return () => subscription.remove();
    },
    close: () => handle.close(),
    answered: () => finished("done"),
    readHandling: () => {
      const { language } = currentLocalisation();
      return readSongLinkSetup(language)?.line ?? songLinkHandlingLine("none", language);
    },
    report: (line) => {
      void showToast(line);
    },
  });
  const handle = openOverlay({
    label: currentLocalisation().strings.settings.openSongLinksInWave,
    onDismiss: visit.answer,
    render: () => <SongLinksCard answer={visit.answer} turnOn={visit.turnOn} />,
  });
};
