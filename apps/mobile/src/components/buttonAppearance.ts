import type { ThemeColor } from "../theme/useThemeColor.ts";

export type ButtonTone =
  "accent" | "primary" | "on-glass" | "destructive" | "secondary" | "highlight";
export type ButtonHaptic = "selection" | "impact";

const INK = {
  accent: "accent",
  primary: "foreground",
  "on-glass": "foreground",
  destructive: "destructive",
  secondary: "secondary",
  highlight: "highlight",
} as const satisfies Record<ButtonTone, ThemeColor>;

export type IconButtonAppearance = {
  size?: number;
  iconSize?: number;
  strokeWidth?: number;
  tone?: ButtonTone;
  disabled?: boolean;
  disabledTone?: ThemeColor;
  haptic?: ButtonHaptic;
  depth?: number;
};

/** Defaults match the original icon button; overrides preserve existing controls. */
export function iconButtonAppearance({
  size = 48,
  iconSize = 24,
  strokeWidth = 1.5,
  tone = "accent",
  disabled = false,
  disabledTone = "tertiary",
  haptic = "selection",
  depth = 0.1,
}: IconButtonAppearance = {}) {
  return { color: disabled ? disabledTone : INK[tone], size, iconSize, strokeWidth, haptic, depth };
}

export type TextButtonVariant = "text" | "pill" | "plain" | "segment";

export function textButtonAppearance({
  variant = "text",
  tone = "accent",
  disabled = false,
  selected = false,
  pressed = false,
}: {
  variant?: TextButtonVariant;
  tone?: ButtonTone;
  disabled?: boolean;
  selected?: boolean;
  pressed?: boolean;
} = {}): { color: ThemeColor; background: ThemeColor | null; animated: boolean; opacity: number } {
  return {
    color: disabled
      ? "secondary"
      : variant === "pill" && selected
        ? "on-accent"
        : variant === "segment"
          ? selected
            ? "foreground"
            : "secondary"
          : INK[tone],
    background: (variant === "pill" ? (selected ? "accent" : "fill") : null) as ThemeColor | null,
    animated: variant !== "plain",
    opacity: variant === "plain" && pressed ? 0.4 : 1,
  };
}

/** The non-animated path has no Press to gate its action and haptic. */
export function runPlainButtonPress(
  { disabled = false, haptic = "selection" }: { disabled?: boolean; haptic?: ButtonHaptic },
  onPress: () => void,
  feedback: (kind: ButtonHaptic) => void,
): void {
  if (disabled) return;
  feedback(haptic);
  onPress();
}
