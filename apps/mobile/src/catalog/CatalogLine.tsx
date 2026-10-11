import { Text } from "react-native";

import { CATALOG_TRACKING } from "./grid";

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
