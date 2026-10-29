import { withOpacity } from "@wave/core";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { Text, type TextProps } from "react-native";

import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { iconButtonAppearance, type IconButtonAppearance } from "./buttonAppearance";

type IconProps = { size?: number; color?: string; strokeWidth?: number };
export type IconButtonProps = Omit<ComponentProps<typeof Press>, "children"> &
  IconButtonAppearance & {
    onPress: NonNullable<ComponentProps<typeof Press>["onPress"]>;
    icon?: ComponentType<IconProps>;
    /** Spoken label; captions can supply it when there is visible text. */
    label?: string;
    busy?: boolean;
    caption?: string;
    captionProps?: TextProps & { className?: string };
    layout?: "vertical" | "horizontal";
    /** A wash of the glyph ink, used by buttons inside glass cards. */
    fillOpacity?: number;
    /** A custom face, such as a theme swatch or an animated glyph. */
    children?: ReactNode | ((color: string) => ReactNode);
  };

/**
 * A shared icon target, with optional caption and the usual press/menu
 * feedback. Disabled, it ignores taps but keeps a long press it has (a Now
 * Playing slot's Change Button).
 */
export function IconButton({
  icon: Icon,
  label,
  caption,
  captionProps,
  layout = "vertical",
  fillOpacity,
  children,
  size,
  iconSize,
  strokeWidth,
  tone,
  disabled = false,
  disabledTone,
  haptic,
  depth,
  busy,
  accessibilityRole = "button",
  accessibilityLabel = label ?? caption,
  accessibilityState,
  className = "",
  style,
  onPress,
  ...press
}: IconButtonProps) {
  const holds = disabled && press.onLongPress != null;
  const look = iconButtonAppearance({
    size,
    iconSize,
    strokeWidth,
    tone,
    disabled,
    disabledTone,
    haptic,
    depth,
  });
  const color = useThemeColor(look.color);
  return (
    <Press
      {...press}
      onPress={disabled ? undefined : onPress}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{
        disabled,
        ...(busy === undefined ? {} : { busy }),
        ...accessibilityState,
      }}
      disabled={disabled && !holds}
      haptic={disabled ? undefined : look.haptic}
      depth={look.depth}
      className={`items-center justify-center ${layout === "horizontal" ? "flex-row" : ""} ${className}`}
      style={[
        { width: look.size, height: look.size },
        fillOpacity !== undefined && { backgroundColor: withOpacity(color, fillOpacity) },
        style,
      ]}
    >
      {(typeof children === "function" ? children(color) : children) ??
        (Icon && <Icon size={look.iconSize} color={color} strokeWidth={look.strokeWidth} />)}
      {caption !== undefined && (
        <Text
          {...captionProps}
          className={captionProps?.className ?? "font-sans text-body"}
          style={[{ color }, captionProps?.style]}
        >
          {caption}
        </Text>
      )}
    </Press>
  );
}
