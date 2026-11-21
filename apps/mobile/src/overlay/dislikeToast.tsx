import { dislikeToast } from "@wave/core";

import { DislikedIcon } from "@/components/DislikedIcon";
import { currentLocalisation } from "@/localisation/localisation";
import { useThemeColor } from "@/theme/useThemeColor";

import { showToast } from "./toast";

function ToastIcon() {
  const foreground = useThemeColor("foreground");
  return <DislikedIcon size={20} color={foreground} />;
}

/** Confirms disliking [count] songs, with Undo ([undo] puts back what was there before). */
export const showDislikeToast = (on: boolean, count: number, undo: () => void): void => {
  const { language, strings } = currentLocalisation();
  const text = dislikeToast(on, count, language);
  if (text !== null)
    void showToast(text, { label: strings.playbackText.undo, run: undo }, <ToastIcon />);
};
