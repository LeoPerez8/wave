import { artistInitial } from "@wave/core";
import { IconUser } from "@tabler/icons-react-native";
import { Image } from "expo-image";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { useThemeColor } from "@/theme/useThemeColor";

/** The account picture's size: a row's leading circle, like an artist's. */
export const ACCOUNT_PHOTO = CELL * 5;

/** An account's picture as a circle (people, like artists, are round), else its initial. */
export function AccountPhoto({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const secondary = useThemeColor("secondary");
  const fill = useThemeColor("fill");
  const circle = { width: ACCOUNT_PHOTO, height: ACCOUNT_PHOTO, borderRadius: ACCOUNT_PHOTO / 2 };
  if (photoUrl !== null)
    return (
      <Image
        source={{ uri: photoUrl }}
        style={[circle, { backgroundColor: fill }]}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
    );
  const initial = artistInitial(name);
  return (
    <View className="items-center justify-center bg-fill" style={circle}>
      {initial === "" ? (
        <IconUser size={ACCOUNT_PHOTO / 3} color={secondary} strokeWidth={1.25} />
      ) : (
        <Text className="font-sans text-body font-light text-secondary">{initial}</Text>
      )}
    </View>
  );
}
