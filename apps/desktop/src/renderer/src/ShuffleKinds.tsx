import { SHUFFLE_KINDS, type ShuffleKind } from "@wave/core";
import { itemMenuEvents, type MenuItem, type MenuPoint } from "./Menu.tsx";
import { labels, text } from "./text.ts";

/** A kind of shuffle's name and the phone's line saying what it does (story 25a). */
const kindText = (kind: ShuffleKind): { readonly name: string; readonly line: string } => {
  const strings = text.playbackText;
  switch (kind) {
    case "real":
      return { name: strings.realShuffle, line: strings.anyOrderEveryOneAsLikely };
    case "smart":
      return { name: strings.smartShuffle, line: strings.yourMostPlayedSpreadAmongTheRest };
    case "even":
      return { name: strings.evenShuffle, line: strings.artistsTakeTurnsNeverTwiceInARow };
  }
};

/**
 * What a shuffle control adds to open the kinds menu on a right-click, Shift+F10 or the Menu
 * key: Real, Smart and Even Shuffle, the chosen one checked. Picking one saves it for every
 * shuffle and shuffles Up Next by it, turning shuffle on, as the phone's card does. [open] is
 * `useSongActions`' `openItems`; [run] is the player's, so the bar follows the change.
 */
export const shuffleMenuEvents = (
  open: (label: string, items: Promise<readonly MenuItem[]>, at: MenuPoint) => void,
  run: (action: Promise<unknown>) => void,
) => ({
  "aria-haspopup": "menu" as const,
  ...itemMenuEvents((at) =>
    open(
      labels.shuffle,
      window.wave.settings.playback().then(({ shuffleKind }) =>
        SHUFFLE_KINDS.map((kind) => ({
          key: kind,
          label: kindText(kind).name,
          line: kindText(kind).line,
          checked: kind === shuffleKind,
          run: () =>
            run(
              window.wave.settings
                .setPlayback({ shuffleKind: kind })
                .then(() => window.wave.playback.command({ type: "reshuffle" })),
            ),
        })),
      ),
      at,
    ),
  ),
});

/** Settings › Playback's Shuffle: the same choice; the next shuffle uses it. */
export function ShuffleKindSetting({
  kind,
  onChange,
}: {
  readonly kind: ShuffleKind;
  readonly onChange: (kind: ShuffleKind) => void;
}) {
  return (
    <section
      className="mt-6 border-y border-separator py-3"
      role="radiogroup"
      aria-labelledby="shuffle-kind"
    >
      <div id="shuffle-kind">{labels.shuffle}</div>
      {SHUFFLE_KINDS.map((each) => (
        <label key={each} className="mt-3 flex items-center justify-between gap-4">
          <span>
            <span className="block">{kindText(each).name}</span>
            <span className="block text-sm text-secondary">{kindText(each).line}</span>
          </span>
          <input
            type="radio"
            name="shuffle-kind"
            className="size-4 accent-accent"
            checked={each === kind}
            onChange={() => onChange(each)}
          />
        </label>
      ))}
    </section>
  );
}
