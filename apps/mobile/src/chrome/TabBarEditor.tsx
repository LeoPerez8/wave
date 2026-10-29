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
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { pressedRect } from "@/motion/pressedRect";
import { openOverlay } from "@/overlay/overlay";
import { getTabBar, setTabBar } from "@/settings/tabBar";

import { tabLook } from "./tabs";

/**
 * The tab bar's editor: Home first (it can't move or go), the tabs after it
 * (drag to reorder, a button removes one), Search last while it's on, then
 * the tabs off the bar (a button adds one, until five fit). The caller keeps
 * [bar] and applies each [edit]; given [onDone] it's the card's, with Done,
 * and without it Settings › Layout › Tab bar's page.
 */
export function TabBarEditor({
  bar,
  edit,
  onDone,
}: {
  bar: TabBar;
  edit: (change: TabBarEdit) => void;
  onDone?: (() => void) | undefined;
}) {
  const { strings } = useLocalisation();
  const title = (tab: TabBarTab): string => tabLook(tab, strings).label;
  const search = bar.includes("search");
  const middle = movableTabs(bar);
  const place = strings.arrangement.tabBar;
  return (
    <ArrangementEditor
      shown={middle}
      hidden={tabsOffBar(bar)}
      title={title}
      place={place}
      hiddenHeading={strings.arrangement.notInTabBar}
      edit={edit}
      canAdd={!tabBarFull(bar)}
      first={
        <FixedRow title={title("index")} place={place} divider={middle.length > 0 || search} />
      }
      last={
        search ? (
          <FixedRow
            title={title("search")}
            place={place}
            divider={false}
            onRemove={() => edit({ remove: "search" })}
          />
        ) : undefined
      }
      note={strings.arrangement.tabBarNote}
      onDone={onDone}
    />
  );
}

/**
 * The tab bar's editor in the card a long press on the bar opens: the edits
 * stay in the card until Done hands the bar to [done]; until then the bar
 * stays as it was.
 */
function TabBarEditorCard({ initial, done }: { initial: TabBar; done: (bar: TabBar) => void }) {
  const [bar, setBar] = useState(initial);
  const edit = useCallback(
    (change: TabBarEdit) => setBar((current) => editTabBar(current, change)),
    [],
  );
  return <TabBarEditor bar={bar} edit={edit} onDone={() => done(bar)} />;
}

/**
 * Opens the tab bar's editor, a card next to the pressed tab (call it from a
 * long press on the bar). Done saves the bar; Back or a tap outside leaves it
 * as it was.
 */
export const openTabBarEditor = (): void => {
  openOverlay({
    label: currentLocalisation().strings.arrangement.editTabBar,
    anchor: pressedRect(),
    render: (close) => (
      <TabBarEditorCard
        initial={getTabBar()}
        done={(bar) => {
          close();
          setTabBar(bar);
        }}
      />
    ),
  });
};
