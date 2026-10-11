import type { ComponentType } from "react";

import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

type Props = {
  icon: ComponentType<IconProps>;
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

/** A 48dp icon-only control in the accent tone. */
export function IconButton({ icon: Icon, label, onPress, disabled = false }: Props) {
  const accent = useThemeColor("accent");
  const tertiary = useThemeColor("tertiary");
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      haptic="selection"
      depth={0.1}
      className="items-center justify-center"
      style={{ width: 48, height: 48 }}
    >
      <Icon size={24} color={disabled ? tertiary : accent} strokeWidth={1.5} />
    </Press>
  );
}
