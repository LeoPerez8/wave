import { ACTION_ICONS } from "@/playback/actionIcons";
import { useThemeColor } from "@/theme/useThemeColor";

import { showToast } from "./toast";

/** Where an Add to Queue or a Play Next put its songs. */
export type QueuedWhere = "addToQueue" | "playNext";

function QueuedIcon({ where }: { where: QueuedWhere }) {
  const foreground = useThemeColor("foreground");
  const Icon = ACTION_ICONS[where];
  return <Icon size={20} color={foreground} />;
}

/** Confirms an Add to Queue or a Play Next ([text], Core's `queuedToast`) with its menu entry's icon. */
export const showQueuedToast = (text: string, where: QueuedWhere): void =>
  void showToast(text, null, <QueuedIcon where={where} />);
