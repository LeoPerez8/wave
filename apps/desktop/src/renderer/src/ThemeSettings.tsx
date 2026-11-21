import {
  customInkPreview,
  inkSaveState,
  isDefaultThemeChoice,
  parseHexColour,
  readThemeChoice,
  themeSwatchRows,
  type InkGroup,
  type Scheme,
  type ThemeChoice,
  type ThemeEdit,
  type ThemeGroup,
  type ThemeSwatchRow,
} from "@wave/core";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Appearance } from "../../shared/bridge.ts";
import { Icon } from "./Icon.tsx";
import { text } from "./text.ts";
import "./themeSettings.css";

/** The scheme the window shows: the Appearance choice, or the system's under System. */
const useScheme = (appearance: Appearance): Scheme => {
  const [system, setSystem] = useState<Scheme>(() =>
    matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => setSystem(media.matches ? "dark" : "light");
    follow();
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);
  return appearance === "system" ? system : appearance;
};

const rowLabel = (group: ThemeGroup): string =>
  ({
    light: text.settings.lightBackground,
    dark: text.settings.darkBackground,
    primary: text.settings.primary,
    secondary: text.settings.secondary,
  })[group];

/** A row is one tab stop: the arrows, Home and End move between its swatches. */
const moveBetweenSwatches = (event: KeyboardEvent<HTMLDivElement>) => {
  if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "radio")
    return;
  const swatches = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const at = swatches.indexOf(event.target);
  const step =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : undefined;
  const to =
    step !== undefined
      ? (at + step + swatches.length) % swatches.length
      : event.key === "Home"
        ? 0
        : event.key === "End"
          ? swatches.length - 1
          : undefined;
  if (to === undefined) return;
  event.preventDefault();
  swatches[to]?.focus();
};

/** A colour dot, checked when it's the one in use. */
function Swatch({
  label,
  colour,
  mark,
  selected,
  tabStop,
  custom = false,
  expanded,
  onPick,
}: {
  readonly label: string;
  /** Null for the custom swatch with no colour of its own to show: a hue wheel. */
  readonly colour: string | null;
  readonly mark: string | null;
  readonly selected: boolean;
  readonly tabStop: boolean;
  readonly custom?: boolean;
  readonly expanded?: boolean;
  readonly onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      className={custom ? "theme-swatch theme-swatch-custom" : "theme-swatch"}
      aria-label={label}
      aria-checked={selected}
      aria-expanded={expanded}
      title={label}
      tabIndex={tabStop ? 0 : -1}
      style={
        {
          "--swatch": colour ?? "transparent",
          "--swatch-mark": mark ?? "transparent",
        } as CSSProperties
      }
      onClick={onPick}
    >
      <span className="theme-swatch-dot">
        {selected && mark !== null ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m5 12 5 5 9-10" />
          </svg>
        ) : null}
      </span>
    </button>
  );
}

/**
 * The colour picker of Primary or Secondary: the system's colour well or a typed hex, shown as
 * it would apply in each mode. Save keeps the colour in the row without applying it; Done
 * applies it.
 */
function ColourPicker({
  group,
  choice,
  start,
  onEdit,
  onClose,
}: {
  readonly group: InkGroup;
  readonly choice: ThemeChoice;
  readonly start: string;
  readonly onEdit: (edit: ThemeEdit) => void;
  readonly onClose: () => void;
}) {
  const [typed, setTyped] = useState(start.replace("#", ""));
  const hex = parseHexColour(typed);
  /** The colour well keeps the last colour while the typed text isn't one. */
  const [well, setWell] = useState(parseHexColour(start) ?? "#000000");
  const type = (value: string) => {
    setTyped(value.replace("#", ""));
    setWell((last) => parseHexColour(value) ?? last);
  };
  const preview = customInkPreview(choice, group, hex ?? "");
  const saving = inkSaveState(choice, group, typed);
  const note =
    hex === null
      ? text.settings.enterA3Or6digitHexColour
      : saving === "saved"
        ? text.settings.thisColourIsSaved
        : saving === "full"
          ? text.settings.fourColoursAreSavedToSaveThis
          : preview.light.adjusted || preview.dark.adjusted
            ? text.settings.adjustedColour(preview.light.adjusted, preview.dark.adjusted)
            : undefined;
  const title = group === "primary" ? text.settings.primaryColour : text.settings.secondaryColour;
  return (
    <div
      className="theme-picker"
      role="group"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="theme-picker-fields">
        <input
          type="color"
          aria-label={text.settings.customColour}
          autoFocus
          value={well}
          onChange={(event) => type(event.target.value)}
        />
        <label className="theme-picker-hex">
          <span aria-hidden="true">#</span>
          <input
            type="text"
            aria-label={text.settings.hexColour}
            aria-invalid={hex === null}
            placeholder={text.settings.hexPlaceholder}
            spellCheck={false}
            maxLength={7}
            value={typed}
            onChange={(event) => type(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || hex === null) return;
              // Focus goes back to the custom swatch: this Enter mustn't press it too.
              event.preventDefault();
              onEdit({ kind: "custom", group, hex });
              onClose();
            }}
          />
        </label>
        {(["light", "dark"] as const).map((scheme) => (
          <span
            key={scheme}
            className="theme-picker-preview"
            role="img"
            aria-label={text.settings.colourMode(text.settings[scheme], preview[scheme].colour)}
            style={{ background: preview[scheme].ground, color: preview[scheme].colour }}
          >
            <span className="theme-picker-ink" />
            {text.settings[scheme]}
          </span>
        ))}
      </div>
      <p className="theme-picker-note" role="status">
        {note}
      </p>
      <div className="theme-picker-actions">
        <button
          type="button"
          // Not `disabled`: Save keeps the keyboard's focus once the colour is saved.
          aria-disabled={saving !== "ready"}
          title={text.settings.addsThisColourToTheSavedColours}
          onClick={() => hex !== null && saving === "ready" && onEdit({ kind: "save", group, hex })}
        >
          {text.settings.save}
        </button>
        <button type="button" onClick={onClose}>
          {text.settings.cancel}
        </button>
        <button
          type="button"
          disabled={hex === null}
          onClick={() => {
            if (hex === null) return;
            onEdit({ kind: "custom", group, hex });
            onClose();
          }}
        >
          {text.settings.done}
        </button>
      </div>
    </div>
  );
}

function ThemeRow({
  row,
  choice,
  picking,
  onPicking,
  onEdit,
}: {
  readonly row: ThemeSwatchRow;
  readonly choice: ThemeChoice;
  readonly picking: boolean;
  readonly onPicking: (open: boolean) => void;
  readonly onEdit: (edit: ThemeEdit) => void;
}) {
  const { group, custom } = row;
  const ink = group === "primary" || group === "secondary" ? group : undefined;
  const customSwatch = useRef<HTMLDivElement>(null);
  const chosen = row.swatches.find((swatch) => swatch.selected);
  const saved = row.saved.find((swatch) => swatch.selected);
  const label = rowLabel(group);
  /** The checked swatch takes the row's tab stop, or its first with none checked. */
  const anyChecked =
    chosen !== undefined || saved !== undefined || (custom !== null && custom.selected);
  const close = () => {
    onPicking(false);
    customSwatch.current?.querySelector("button")?.focus();
  };
  return (
    <div className="theme-row">
      <div className="theme-row-heading">
        <h3>{label}</h3>
        <span>
          {custom?.selected
            ? text.settings.custom
            : saved !== undefined
              ? text.settings.saved
              : chosen?.label}
        </span>
      </div>
      <div
        className="theme-swatches"
        role="radiogroup"
        aria-label={label}
        onKeyDown={moveBetweenSwatches}
      >
        {row.swatches.map((swatch, index) => (
          <Swatch
            key={swatch.id}
            label={swatch.label}
            colour={swatch.colour}
            mark={swatch.mark}
            selected={swatch.selected}
            tabStop={swatch.selected || (!anyChecked && index === 0)}
            onPick={() => onEdit({ kind: "swatch", group, id: swatch.id })}
          />
        ))}
        {ink !== undefined && custom !== null ? (
          <>
            {row.saved.map((swatch, index) => {
              const name = text.settings.savedColour(index + 1, swatch.hex);
              return (
                <span key={swatch.hex} className="theme-saved">
                  <Swatch
                    label={name}
                    colour={swatch.colour}
                    mark={swatch.mark}
                    selected={swatch.selected}
                    tabStop={swatch.selected}
                    onPick={() => onEdit({ kind: "saved", group: ink, hex: swatch.hex })}
                  />
                  <button
                    type="button"
                    className="theme-saved-remove"
                    aria-label={text.settings.removeSavedColour(name)}
                    title={text.settings.remove}
                    onClick={() => onEdit({ kind: "remove", group: ink, hex: swatch.hex })}
                  >
                    <Icon name="close" />
                  </button>
                </span>
              );
            })}
            <span ref={customSwatch} className="theme-saved">
              <Swatch
                custom
                label={text.settings.customColour}
                colour={custom.colour}
                mark={custom.mark}
                selected={custom.selected}
                tabStop={custom.selected}
                expanded={picking}
                onPick={() => onPicking(!picking)}
              />
            </span>
          </>
        ) : null}
      </div>
      {ink !== undefined && custom !== null && picking ? (
        <ColourPicker
          group={ink}
          choice={choice}
          start={custom.picked ?? saved?.hex ?? chosen?.colour ?? "#000000"}
          onEdit={onEdit}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

/**
 * Settings › Appearance's Theme: a background for each mode from its swatches, and Primary and
 * Secondary from Default, their saved colours and a custom one. Core's theme choice rules give
 * the rows; main makes each change to the account's theme, and [onChange] gets the theme as it
 * is kept then so the window follows at once.
 */
export function ThemeSettings({
  theme,
  appearance,
  onChange,
  onError,
}: {
  /** The account's stored theme (`AccountView.theme`). */
  readonly theme: string | null;
  readonly appearance: Appearance;
  readonly onChange: (stored: string) => void;
  readonly onError: () => void;
}) {
  const scheme = useScheme(appearance);
  const choice = readThemeChoice(theme);
  const [picking, setPicking] = useState<ThemeGroup>();
  const edit = (change: ThemeEdit) =>
    void window.wave.settings.editTheme(change).then(onChange).catch(onError);
  return (
    <div className="theme-settings">
      <h2>{text.settings.theme}</h2>
      {themeSwatchRows(choice, scheme, text).map((row) => (
        <ThemeRow
          key={row.group}
          row={row}
          choice={choice}
          picking={picking === row.group}
          onPicking={(open) => setPicking(open ? row.group : undefined)}
          onEdit={edit}
        />
      ))}
      <p className="theme-hint">{text.settings.cardsGroupsSeparatorsAndTextFollowThe}</p>
      <button
        type="button"
        disabled={isDefaultThemeChoice(choice)}
        onClick={() => {
          setPicking(undefined);
          edit({ kind: "reset" });
        }}
      >
        {text.settings.resetToDefaults}
      </button>
    </div>
  );
}
