import { StyleSheet, View } from "react-native";

/** A one-pixel rule in the separator tone. */
export function Hairline({ className = "" }: { className?: string }) {
  return (
    <View className={`bg-separator ${className}`} style={{ height: StyleSheet.hairlineWidth }} />
  );
}
