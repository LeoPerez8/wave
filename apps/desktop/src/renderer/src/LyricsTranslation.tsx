/** Translate's pieces of the Lyrics view: its header button, the quiet note and a line's translation. */
import { Icon } from "./Icon.tsx";
import { text } from "./text.ts";
import type { LyricsTranslationView, TranslationShown } from "./useLyricsTranslation.ts";

/** Turns translation into the app's language on and off, for every song until it's turned off. */
export function TranslateButton({
  on,
  onChange,
}: {
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  const label = text.playbackText.translateLyrics;
  return (
    <button
      className="icon-button lyrics-translate"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      <Icon name="translate" size={18} />
    </button>
  );
}

/**
 * The quiet line above the lyrics when nothing goes under them: they're already in the app's
 * language, or the translation failed (with Try Again).
 */
export function TranslationNote({ shown, retry }: LyricsTranslationView) {
  const words = text.playbackText;
  if (shown?.kind === "sameLanguage")
    return (
      <p className="translation-note" role="status">
        {words.theseLyricsAreAlreadyInValue(shown.language)}
      </p>
    );
  if (shown?.kind === "failed")
    return (
      <p className="translation-note" role="status">
        <span>{words.couldntTranslateTheLyrics}</span>
        <button className="text-button" onClick={retry}>
          {words.tryAgain}
        </button>
      </p>
    );
  return null;
}

/** How wide each line's skeleton is, by its place: ragged, as lyrics are. */
const SKELETON = [64, 48, 72, 56, 68];

/** What sits under the lyric line at [index] with words [line]: its translation, or its skeleton. */
export function LineTranslation({
  shown,
  index,
  line,
}: {
  readonly shown: TranslationShown | null;
  readonly index: number;
  readonly line: string;
}) {
  if (shown?.kind === "loading" && line.trim() !== "")
    return (
      <span
        className="lyric-translation-skeleton"
        style={{ width: `${SKELETON[index % SKELETON.length]}%` }}
      />
    );
  const translation = shown?.kind === "translated" ? shown.lines[index] : null;
  return translation ? <span className="lyric-translation">{translation}</span> : null;
}
