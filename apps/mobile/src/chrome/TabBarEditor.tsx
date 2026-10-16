import {
  editTabBar,
  movableTabs,
  tabBarFull,
  tabsOffBar,
  type TabBar,
  type TabBarEdit,
  type TabBarTab,
} from "@wave/core";
import { useCallback, useState } from "react";

import { ArrangementEditor, FixedRow } from "@/components/ArrangementEditor";
import { pressedRect } from "@/motion/pressedRect";
import { openOverlay } from "@/overlay/overlay";
import { getTabBar, setTabBar } from "@/settings/tabBar";

import { tabLook } from "./tabs";

const PLACE = "the tab bar";
const title = (tab: TabBarTab): string => tabLook(tab).label;

/**
 * The tab bar's editor, opened by a long press on the bar: Home first (it
 * can't move or go), the tabs after it (drag to reorder, a button removes
 * one), Search last while it's on, then the tabs off the bar (a button adds
 * one, until five fit). Done hands the bar to [done]; until then the bar
 * stays as it was.
 */
function TabBarEditor({ initial, done }: { initial: TabBar; done: (bar: TabBar) => void }) {
  const [bar, setBar] = useState(initial);
  const edit = useCallback(
    (change: TabBarEdit) => setBar((current) => editTabBar(current, change)),
    [],
  );
  const search = bar.includes("search");
  const middle = movableTabs(bar);
  return (
    <ArrangementEditor
      shown={middle}
      hidden={tabsOffBar(bar)}
      title={title}
      place={PLACE}
      hiddenHeading="Not in the tab bar"
      edit={edit}
      canAdd={!tabBarFull(bar)}
      first={
        <FixedRow title={title("index")} place={PLACE} divider={middle.length > 0 || search} />
      }
      last={
        search ? (
          <FixedRow
            title={title("search")}
            place={PLACE}
            divider={false}
            onRemove={() => edit({ remove: "search" })}
          />
        ) : undefined
      }
      note="Home stays first, and Search keeps its own pill at the end. Up to five tabs fit."
      onDone={() => done(bar)}
    />
  );
}

/**
 * Opens the tab bar's editor, a card next to the pressed tab (call it from a
 * long press on the bar). Done saves the bar; Back or a tap outside leaves it
 * as it was.
 */
export const openTabBarEditor = (): void => {
  openOverlay({
    label: "Edit tab bar",
    anchor: pressedRect(),
    render: (close) => (
      <TabBarEditor
        initial={getTabBar()}
        done={(bar) => {
          close();
          setTabBar(bar);
        }}
      />
    ),
  });
};
