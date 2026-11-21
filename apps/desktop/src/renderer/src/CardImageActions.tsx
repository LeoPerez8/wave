import { useState } from "react";
import { cardPng } from "./cardImage.ts";
import { text } from "./text.ts";

/**
 * Save Image and Copy Image for a card on screen (a Recap story, a lyrics card, a song card).
 * [card] is the element to draw, laid out at 1080 by 1920 at most; [fileName] is Core's name for its
 * PNG (`recapCardFileName`, `lyricCardFileName`…), read when Save Image is pressed.
 */
export function CardImageActions({
  card,
  fileName,
  notify,
  onBusy,
}: {
  readonly card: () => HTMLElement | null;
  readonly fileName: () => string;
  readonly notify: (message: string) => void;
  /** The image is being drawn or the save dialog is open: what moves by itself should wait. */
  readonly onBusy?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const act = async (kind: "save" | "copy") => {
    const element = card();
    if (element === null || busy) return;
    setBusy(true);
    onBusy?.(true);
    try {
      const png = await cardPng(element);
      if (kind === "copy") {
        await window.wave.cards.copyImage(png);
        notify(text.share.imageCopied);
      } else if (await window.wave.cards.saveImage(fileName(), png)) {
        notify(text.share.imageSaved);
      }
    } catch {
      notify(kind === "copy" ? text.share.copyImageFailed : text.share.saveImageFailed);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };
  return (
    <div className="card-image-actions">
      <button disabled={busy} onClick={() => void act("save")}>
        {text.share.saveImage}
      </button>
      <button disabled={busy} onClick={() => void act("copy")}>
        {text.share.copyImage}
      </button>
    </div>
  );
}
