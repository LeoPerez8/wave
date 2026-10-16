import { Text, View } from "react-native";

import { CATALOG_TRACKING, CELL } from "./grid";

type Props = {
  children: string;
  tone?: "secondary" | "accent" | "highlight";
  className?: string;
};

const toneClass = {
  secondary: "text-secondary",
  accent: "text-accent",
  highlight: "text-highlight",
} as const;

/** A label's catalog line: small, tracked caps. Section heads and cover captions. */
export function CatalogLine({ children, tone = "secondary", className = "" }: Props) {
  return (
    <Text
      numberOfLines={1}
      className={`font-sans text-catalog font-semibold uppercase ${toneClass[tone]} ${className}`}
      style={{ letterSpacing: CATALOG_TRACKING }}
    >
      {children}
    </Text>
  );
}

/** A section head's height in a list of artist sections (Albums, Songs…). */
export const SECTION_HEAD = CELL * 6;

/** A list's section head: its catalog line, sitting on the section below. */
export function SectionHead({ label }: { label: string }) {
  return (
    <View className="justify-end" style={{ height: SECTION_HEAD, paddingBottom: CELL }}>
      <CatalogLine>{label}</CatalogLine>
    </View>
  );
}
