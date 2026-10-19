import { Text, View } from "react-native";

import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";

const SIGN_IN_LABELS = {
  signIn: "Sign In",
  signInAgain: "Sign In Again",
  signingIn: "Signing In…",
} as const;

/**
 * A signed-out account in Settings: Sign In (Sign In Again for a session that
 * ended; it waits while the sign-in page is open) and the line under it.
 */
export function SignInRows({
  action,
  note,
  onSignIn,
}: {
  action: keyof typeof SIGN_IN_LABELS;
  note: string;
  onSignIn: () => void;
}) {
  return (
    <>
      <View className="items-start" style={{ minHeight: grid.row, justifyContent: "center" }}>
        <TextButton
          label={SIGN_IN_LABELS[action]}
          disabled={action === "signingIn"}
          onPress={onSignIn}
        />
      </View>
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">{note}</Text>
    </>
  );
}
