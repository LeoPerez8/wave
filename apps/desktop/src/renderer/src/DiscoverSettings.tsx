/**
 * Discover's level card (docs/spec.md, Editable Home): New music, Genre faithfulness and
 * Popularity, one set for the Magic Queue, Artist mixes and Genre mixes, kept on this computer.
 * A move applies at once: main re-blends and re-ranks the day's mixes from the radios it read.
 */
import { discoverLevelLabel, sliderStep, type MixSliderStep } from "@wave/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { DiscoverSettings } from "../../shared/ytPages.ts";
import { Icon } from "./Icon.tsx";
import { text } from "./text.ts";

type Slider = keyof DiscoverSettings;

const SLIDERS: readonly {
  readonly key: Slider;
  readonly label: string;
  readonly step: (value: MixSliderStep) => string;
}[] = [
  {
    key: "level",
    label: text.discover.newMusic,
    step: (value) => discoverLevelLabel(value, text),
  },
  {
    key: "faithfulness",
    label: text.discover.genreFaithfulness,
    step: (value) => text.discover.faithfulnessSteps[value],
  },
  {
    key: "popularity",
    label: text.discover.popularity,
    step: (value) => text.discover.popularitySteps[value],
  },
];

/** The card, beside [at]; Esc or a click outside closes it and focus goes back to the icon. */
function DiscoverCard({
  at,
  onChanged,
  onClose,
}: {
  readonly at: DOMRect;
  readonly onChanged: () => void;
  readonly onClose: () => void;
}) {
  const [settings, setSettings] = useState<DiscoverSettings>();
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    void window.wave.discover
      .settings()
      .then((read) => {
        if (current) setSettings(read);
      })
      .catch(onClose);
    return () => {
      current = false;
    };
  }, [onClose]);
  const loaded = settings !== undefined;
  useLayoutEffect(() => {
    if (loaded) card.current?.querySelector<HTMLElement>("input")?.focus();
  }, [loaded]);
  const change = (key: Slider, value: number) => {
    if (settings === undefined) return;
    const next = { ...settings, [key]: sliderStep(value) };
    setSettings(next);
    void window.wave.discover.setSettings(next).then(onChanged, () => {});
  };
  const key = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };
  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} />
      <div
        ref={card}
        className="discover-card"
        role="dialog"
        aria-labelledby="discover-card-title"
        style={{ top: at.bottom + 6, right: Math.max(8, innerWidth - at.right) }}
        onKeyDown={key}
      >
        <h2 id="discover-card-title">{text.home.sections.discover}</h2>
        {settings !== undefined &&
          SLIDERS.map(({ key: id, label, step }) => (
            <div key={id} className="discover-slider">
              <label htmlFor={`discover-${id}`}>{label}</label>
              <output htmlFor={`discover-${id}`} className="secondary">
                {step(settings[id])}
              </output>
              <input
                id={`discover-${id}`}
                type="range"
                min={1}
                max={5}
                step={1}
                value={settings[id]}
                aria-valuetext={step(settings[id])}
                onChange={(event) => change(id, Number(event.target.value))}
              />
              {id === "faithfulness" && (
                <p className="discover-note secondary">{text.discover.faithfulnessNote}</p>
              )}
            </div>
          ))}
      </div>
    </>
  );
}

/** Discover's header icon, as large as Home's other icons; it opens the card beside itself. */
export function DiscoverSettingsButton({ onChanged }: { readonly onChanged: () => void }) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setAt(null);
    button.current?.focus();
  }, []);
  return (
    <>
      <button
        ref={button}
        className="icon-button"
        aria-label={text.discover.settings}
        title={text.discover.settings}
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        onClick={() => setAt(button.current!.getBoundingClientRect())}
      >
        <Icon name="adjustments" />
      </button>
      {at !== null && <DiscoverCard at={at} onChanged={onChanged} onClose={close} />}
    </>
  );
}
