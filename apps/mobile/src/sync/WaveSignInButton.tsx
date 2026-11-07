import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";

import { openWaveAccount } from "./openWaveAccount";

/**
 * A signed-out invitation in place of what a Wave account brings (Genius
 * About, shows): [message] says what, and Sign In opens Settings › Accounts,
 * after [beforeOpen] (closing a card). As a `"card"` it stands on its own
 * surface under [heading]; as a `"row"` it sits inside another card.
 */
export function WaveSignInButton({
  message,
  heading,
  look,
  beforeOpen,
}: {
  readonly message: string;
  readonly heading?: string;
  readonly look: "card" | "row";
  readonly beforeOpen?: () => void;
}) {
  const { strings } = useLocalisation();
  const card = look === "card";
  return (
    <TextButton
      label={message}
      tone="primary"
      accessibilityHint={strings.settings.opensTheWaveAccountInSettings}
      onPress={() => {
        beforeOpen?.();
        openWaveAccount();
      }}
      className={card ? "rounded-2xl bg-surface" : ""}
      style={card ? { padding: CELL * 2, marginBottom: CELL * 2 } : { paddingVertical: CELL }}
    >
      <View>
        {heading === undefined ? null : (
          <Text className="font-sans text-footnote font-semibold text-secondary">{heading}</Text>
        )}
        <Text
          className={
            card ? "font-sans text-body text-foreground" : "font-sans text-footnote text-secondary"
          }
          style={heading === undefined ? undefined : { marginTop: CELL / 2 }}
        >
          {message}
        </Text>
        <Text
          className="font-sans text-footnote font-medium text-accent"
          style={{ marginTop: card ? CELL : CELL / 2 }}
        >
          {strings.settings.signIn}
        </Text>
      </View>
    </TextButton>
  );
}
