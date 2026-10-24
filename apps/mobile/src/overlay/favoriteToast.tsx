import { IconStarFilled } from "@tabler/icons-react-native";
import { favoriteToast, type FavoriteSource } from "@wave/core";

import { useThemeColor } from "@/theme/useThemeColor";

import { showToast } from "./toast";

function FavoriteIcon() {
  const highlight = useThemeColor("highlight");
  return <IconStarFilled size={20} color={highlight} />;
}

/** Confirms a favorite where the song's star doesn't already show the change. */
export const showFavoriteToast = (source: FavoriteSource, on: boolean, count: number): void => {
  const text = favoriteToast(source, on, count);
  if (text !== null) void showToast(text, null, <FavoriteIcon />);
};
