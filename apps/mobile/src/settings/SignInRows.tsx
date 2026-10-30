import { Text, View } from "react-native";

import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";

/**
 * A signed-out account in Settings: Sign In (Sign In Again for a session that
 * ended; it waits while the sign-in page is open) and the line under it.
 */
export function SignInRows({
  action,
  note,
  onSignIn,
}: {
  action: "signIn" | "signInAgain" | "signingIn";
  note: string;
  onSignIn: () => void;
}) {
  const { strings } = useLocalisation();
  return (
    <>
      <View className="items-start" style={{ minHeight: grid.row, justifyContent: "center" }}>
        <TextButton
          label={strings.settings[action]}
          disabled={action === "signingIn"}
          onPress={onSignIn}
        />
      </View>
      <Hairline />
      <Text
        accessibilityLiveRegion="polite"
        className="mt-2 font-sans text-footnote text-secondary"
      >
        {note}
      </Text>
    </>
  );
}
