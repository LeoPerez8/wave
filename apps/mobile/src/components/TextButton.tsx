import * as Haptics from "expo-haptics";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, Text, View, type TextProps } from "react-native";

import { CELL } from "@/catalog/grid";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import {
  textButtonAppearance,
  runPlainButtonPress,
  type ButtonTone,
  type TextButtonVariant,
} from "./buttonAppearance";

export type TextButtonProps = Omit<ComponentProps<typeof Press>, "children"> & {
  onPress: NonNullable<ComponentProps<typeof Press>["onPress"]>;
  label: string;
  tone?: ButtonTone;
  variant?: TextButtonVariant;
  selected?: boolean;
  labelProps?: TextProps & { className?: string };
  /** Custom content for a choice row or card, retaining the shared press. */
  children?: ReactNode | ((color: string) => ReactNode);
};

const MENU_INSET = { paddingHorizontal: CELL * 1.5, marginHorizontal: -CELL * 1.5 } as const;

/** Text actions, pills, period segments and non-animated actions for long lists. */
export function TextButton({
  label,
  onPress,
  tone = "accent",
  variant = "text",
  selected = false,
  disabled = false,
  opensMenu = false,
  haptic = "selection",
  depth,
  labelProps,
  children,
  accessibilityRole = "button",
  accessibilityState,
  style,
  className = "",
  ...press
}: TextButtonProps) {
  const look = textButtonAppearance({ variant, tone, disabled, selected });
  const [color, background, accent] = useThemeColor([
    look.color,
    look.background ?? "fill",
    "accent",
  ]);
  const segment = variant === "segment";
  const baseStyle = [
    { minHeight: 48, minWidth: segment ? 0 : 48, justifyContent: "center" as const },
    opensMenu && MENU_INSET,
    variant === "pill" && {
      borderRadius: 24,
      paddingHorizontal: CELL * 1.5,
      backgroundColor: background,
    },
    style,
  ];
  const content = (typeof children === "function" ? children(color) : children) ?? (
    <>
      <Text
        {...labelProps}
        numberOfLines={segment ? 1 : labelProps?.numberOfLines}
        className={
          labelProps?.className ??
          `font-sans text-body ${segment ? (selected ? "font-semibold" : "") : "font-medium"}`
        }
        style={[{ color }, labelProps?.style]}
      >
        {label}
      </Text>
      {segment && (
        <View
          style={{
            height: 2,
            marginTop: CELL / 2,
            backgroundColor: selected ? accent : "transparent",
          }}
        />
      )}
    </>
  );
  const state = {
    disabled,
    ...(segment || variant === "pill" ? { selected } : {}),
    ...accessibilityState,
  };
  if (!look.animated) {
    // Downloads rows must not register an animated style (#446).
    return (
      <Pressable
        {...press}
        accessibilityRole={accessibilityRole}
        accessibilityState={state}
        disabled={disabled}
        className={className}
        onPress={(event) =>
          runPlainButtonPress(
            { disabled, haptic },
            () => onPress?.(event),
            (kind) => {
              if (kind === "impact") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              else void Haptics.selectionAsync();
            },
          )
        }
        style={({ pressed }) => [
          baseStyle,
          { opacity: textButtonAppearance({ variant, pressed }).opacity },
        ]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <Press
      {...press}
      accessibilityRole={accessibilityRole}
      accessibilityState={state}
      disabled={disabled}
      onPress={onPress}
      opensMenu={opensMenu}
      haptic={haptic}
      depth={depth}
      className={`justify-center ${className}`}
      style={baseStyle}
    >
      {content}
    </Press>
  );
}
