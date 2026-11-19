import type { CopyLinkResult } from "../../shared/links.ts";
import { text } from "./text.ts";

export const COPIED = "wave-copy-link";
export const OPENED = "wave-open-link";

/** Opens [link] as a pasted one opens: its song plays, or its playlist shows its import card. */
export const openLink = (link: string): void => {
  document.dispatchEvent(new CustomEvent(OPENED, { detail: link }));
};

/** All Copy Link menus report through the same toast or message card. */
export const copyLink = async (copy: Promise<CopyLinkResult>): Promise<void> => {
  const result = await copy.catch((): CopyLinkResult => ({
    kind: "notice",
    notice: {
      title: text.share.copyLink,
      message: text.share.copyFailed,
    },
  }));
  document.dispatchEvent(new CustomEvent(COPIED, { detail: result }));
};
