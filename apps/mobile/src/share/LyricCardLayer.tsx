import { LyricCardPreview } from "./LyricCardPreview";
import { useLyricCard } from "./lyricCard";

/**
 * The lyrics card's preview while one is open (`openLyricCard`), over Now
 * Playing. The preview and its card (and Skia with them) load the first time
 * one opens.
 */
export function LyricCardLayer() {
  const content = useLyricCard();
  return content === null ? null : <LyricCardPreview content={content} />;
}
