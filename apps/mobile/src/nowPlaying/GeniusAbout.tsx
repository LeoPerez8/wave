import { useLocalisation } from "@/localisation/localisation";
import { useState } from "react";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { openWaveAccount } from "@/sync/openWaveAccount";

import type { GeniusAboutCard } from "./useGenius";

/** How many lines of the description show until the card is tapped. */
const FOLDED_LINES = 3;

/**
 * The About card's place while no Wave account is signed in: what an
 * account brings here, and Sign In, which opens Settings › Accounts.
 */
function GeniusSignIn() {
  const { strings } = useLocalisation();
  return (
    <TextButton
      label={strings.playbackText.signInToSeeWhatGeniusSaysAboutThisSong}
      tone="primary"
      accessibilityHint={strings.playbackText.opensTheWaveAccountInSettings}
      onPress={openWaveAccount}
      className="rounded-2xl bg-surface"
      style={{ padding: CELL * 2, marginBottom: CELL * 2 }}
    >
      <View>
        <Text className="font-sans text-footnote font-semibold text-secondary">
          {strings.playbackText.aboutGenius}
        </Text>
        <Text className="font-sans text-body text-foreground" style={{ marginTop: CELL / 2 }}>
          {strings.playbackText.signInToSeeWhatGeniusSaysAboutThisSong}
        </Text>
        <Text
          className="font-sans text-footnote font-medium text-accent"
          style={{ marginTop: CELL }}
        >
          {strings.settings.signIn}
        </Text>
      </View>
    </TextButton>
  );
}

/**
 * The About card at the top of the lyrics (docs/spec.md, "Genius About"):
 * the first lines of Genius's description of the song, and all of it after
 * a tap (another tap folds it again). Nothing without a description, and the
 * invitation to sign in for `"signIn"`. Keyed by its original, a translation
 * arriving replaces the text and keeps the card as it is.
 */
export function GeniusAbout({ about }: { about: GeniusAboutCard | null }) {
  const { strings } = useLocalisation();
  const [expanded, setExpanded] = useState(false);
  if (about === null) return null;
  if (about === "signIn") return <GeniusSignIn />;
  const description = about.shown;
  return (
    <TextButton
      label={strings.playbackText.aboutThisSongFromGeniusValue(description)}
      tone="primary"
      accessibilityState={{ expanded }}
      accessibilityHint={
        expanded ? strings.playbackText.showsLessOfIt : strings.playbackText.showsAllOfIt
      }
      onPress={() => setExpanded((was) => !was)}
      className="rounded-2xl bg-surface"
      style={{ padding: CELL * 2, marginBottom: CELL * 2 }}
    >
      <View>
        <Text className="font-sans text-footnote font-semibold text-secondary">
          {strings.playbackText.aboutGenius}
        </Text>
        <Text
          numberOfLines={expanded ? undefined : FOLDED_LINES}
          className="font-sans text-body text-foreground"
          style={{ marginTop: CELL / 2 }}
        >
          {description}
        </Text>
        <Text
          className="font-sans text-footnote font-medium text-accent"
          style={{ marginTop: CELL }}
        >
          {expanded ? strings.playbackText.showLess : strings.playbackText.more}
        </Text>
      </View>
    </TextButton>
  );
}
