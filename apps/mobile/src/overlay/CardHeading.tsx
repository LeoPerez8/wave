import { createContext, useContext, type ReactNode } from "react";
import { View } from "react-native";

import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";

/**
 * Whether the card being drawn names its item in a heading (Core
 * `cardShowsHeading`): the overlay host settles it as the card opens, so the
 * card's layout never changes under a finger sliding onto its entries.
 */
export const CardHeadingContext = createContext(true);

/**
 * A menu card's heading, the item it acts on (artwork, title, subtitle in a
 * row), ruled off from the entries below. Drawn only when nothing on screen
 * already says what the card is about: a card opened from a highlighted row,
 * tile or button starts straight at its entries. `always` keeps a heading
 * that says more than the highlight does (a Library entry's song count).
 */
export function CardHeading({
  children,
  always = false,
}: {
  children: ReactNode;
  always?: boolean;
}) {
  const shown = useContext(CardHeadingContext);
  if (!shown && !always) return null;
  return (
    <>
      <View
        className="flex-row items-center"
        style={{ paddingBottom: CELL * 1.5, gap: CELL * 1.5 }}
      >
        {children}
      </View>
      <Hairline />
    </>
  );
}
