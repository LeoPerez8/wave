/**
 * The What's New card (docs/spec.md, Build and CI): connects its runner to the update service, the
 * phone's state and Wave's overlays. A build with updates off shows nothing.
 */
import {
  mergeReleaseNotes,
  readPublishedNotes,
  whatsNewNotesUrl,
  type PublishedRelease,
} from "@wave/core";
import * as Effect from "effect/Effect";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { AppState, Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { persistedSetting } from "@/lib/persistedSetting";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { appLog } from "@/log/appLog";
import { isNowPlayingShown, onNowPlayingShownChange } from "@/nowPlaying/sheet";
import { CardEntries } from "@/overlay/CardEntries";
import { isOverlayOpen, onOverlaysChange, openOverlay } from "@/overlay/overlay";

import { RUNNING_VERSION } from "./runningVersion";
import { createWhatsNewRunner } from "./whatsNewRunner";

/** How long the service gets to answer before it counts as a failure. */
const FETCH_TIMEOUT = "15 seconds";

const seenVersion = persistedSetting<string | null>({
  key: "updates.seenVersion",
  read: (stored) => stored,
  write: (version) => version,
});

const fetchNotes = (
  from: string,
  to: string,
): Effect.Effect<readonly PublishedRelease[], unknown> =>
  Effect.gen(function* () {
    const url = whatsNewNotesUrl({
      manifestUrl: Constants.expoConfig?.updates?.url,
      channel: Updates.channel,
      from,
      to,
    });
    if (url === null) return yield* Effect.fail(new Error("No address for the notes"));
    const answer = yield* Effect.tryPromise(async (signal) => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`The service answered ${response.status}`);
      return (await response.json()) as unknown;
    });
    const releases = readPublishedNotes(answer);
    if (releases === null) return yield* Effect.fail(new Error("Unreadable notes"));
    return releases;
  }).pipe(Effect.timeout(FETCH_TIMEOUT));

/** One titled group of lines; an empty one isn't drawn. */
function NoteSection({ title, lines }: { title: string; lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <View style={{ gap: CELL }}>
      <Text
        accessibilityRole="header"
        className="font-sans text-footnote font-semibold text-secondary"
      >
        {title}
      </Text>
      {lines.map((line) => (
        <Text key={line} className="font-sans text-body text-foreground">
          {line}
        </Text>
      ))}
    </View>
  );
}

/** The card's text comes from Core's catalogue; the lines are the service's, as they come. */
function WhatsNewCard({
  releases,
  onDone,
}: {
  releases: readonly PublishedRelease[];
  onDone: () => void;
}) {
  const { language, strings } = useLocalisation();
  const notes = mergeReleaseNotes(releases, language);
  if (notes === null) return null;
  return (
    <>
      <View style={{ paddingBottom: CELL * 2 }}>
        <Text accessibilityRole="header" className="font-sans text-title3 text-foreground">
          {strings.whatsNew.title}
        </Text>
        <Text className="font-sans text-footnote text-secondary">
          {strings.appUpdates.version(RUNNING_VERSION ?? notes.version)}
        </Text>
      </View>
      <CardEntries>
        <View style={{ gap: CELL * 2, paddingBottom: CELL * 2 }}>
          <NoteSection title={strings.whatsNew.new} lines={notes.new} />
          <NoteSection title={strings.whatsNew.fixes} lines={notes.fixes} />
        </View>
      </CardEntries>
      <View className="flex-row items-center justify-end">
        <TextButton label={strings.whatsNew.done} onPress={onDone} />
      </View>
    </>
  );
}

let started = false;

/** Starts following the phone, once per JS runtime, until there's nothing more to say. */
export const startWhatsNew = (): void => {
  if (started || !Updates.isEnabled) return;
  started = true;
  const stops: (() => void)[] = [];
  const runner = createWhatsNewRunner({
    runningVersion: RUNNING_VERSION,
    seenVersion: {
      get: seenVersion.get,
      set: seenVersion.set,
    },
    fetchNotes,
    surroundings: () => ({
      visible: AppState.currentState === "active",
      nowPlayingShown: isNowPlayingShown(),
      cardOpen: isOverlayOpen(),
    }),
    show: (releases, dismissed) => {
      const handle = openOverlay({
        label: currentLocalisation().strings.whatsNew.title,
        onDismiss: dismissed,
        render: (close) => (
          <WhatsNewCard
            releases={releases}
            onDone={() => {
              close();
              dismissed();
            }}
          />
        ),
      });
      return handle.close;
    },
    now: Date.now,
    log: (level, message) => appLog(level, "WaveUpdates", message),
    onFinished: () => {
      for (const stop of stops.splice(0)) stop();
    },
  });
  const appState = AppState.addEventListener("change", runner.reconsider);
  stops.push(
    () => appState.remove(),
    onNowPlayingShownChange(runner.reconsider),
    onOverlaysChange(runner.reconsider),
  );
  runner.reconsider();
};
