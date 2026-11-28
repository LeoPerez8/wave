/**
 * Opening a smart link shared to Wave (docs/spec.md, "Opening a song link" › Smart links): its
 * page is read once, with "Opening link…" meanwhile, and the link it points to opens as if it had
 * been shared (`openSharedText`). Core picks that link (`smartLinkTarget`) and says what a smart
 * link that opens nothing shows (`smartLinkNotice`, `cantOpenNotice`).
 */
import { cantOpenNotice, smartLinkNotice } from "@wave/core";
import { followShortLink } from "@wave/client/serviceTransport";
import { smartLinkEnding } from "@wave/client/smartLinkEnding";

import { currentLocalisation } from "@/localisation/localisation";
import { online } from "@/native/waveNative";
import { showMessage } from "@/overlay/alert";
import { currentToast, dismissToast, showToast } from "@/overlay/toast";

/** How long the page gets to answer, redirects and all. */
const PAGE_TIMEOUT_MS = 20_000;

const say = (notice: { readonly title: string; readonly message: string }): void =>
  void showMessage(notice.title, notice.message);

/**
 * Opens what the smart link [url] points to through [open] (`openSharedText`). Offline it says
 * so and asks nothing; a page out of reach, or one naming nothing Wave opens, says why.
 */
export const openSmartLink = async (url: string, open: (text: string) => void): Promise<void> => {
  const { language, strings } = currentLocalisation();
  if (!online()) {
    say(smartLinkNotice("offline", language));
    return;
  }
  void showToast(strings.imports.openingLink);
  const opening = currentToast.get()?.id;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  let ending;
  try {
    ending = await smartLinkEnding(
      url,
      (page, body, signal) => followShortLink(page, { body }, signal),
      controller.signal,
    );
  } finally {
    clearTimeout(timeout);
  }
  if (opening !== undefined) dismissToast(opening);
  if ("link" in ending) open(ending.link);
  else if (ending.failure === "unreachable") say(smartLinkNotice("unreachable", language));
  else say(cantOpenNotice(language));
};
