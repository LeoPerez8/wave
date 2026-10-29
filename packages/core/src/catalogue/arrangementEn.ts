/**
 * The arrangement editor Home's edit mode and the tab bar's editor share:
 * its buttons and TalkBack actions. A place is named with the preposition it
 * takes ("from Home", "to the tab bar"), which Portuguese contracts.
 */
export const arrangementEn = {
  remove: (title: string, from: string) => `Remove ${title} ${from}`,
  removeAction: (from: string) => `Remove ${from}`,
  add: (title: string, to: string) => `Add ${title} ${to}`,
  moveUp: "Move up",
  moveDown: "Move down",
  done: "Done",
  home: { from: "from Home", to: "to Home" },
  discover: { from: "from Discover", to: "to Discover" },
  tabBar: { from: "from the tab bar", to: "to the tab bar" },
  editTabBar: "Edit tab bar",
  notInTabBar: "Not in the tab bar",
  tabBarNote: "Home stays first, and Search keeps its own pill at the end. Up to five tabs fit.",
};
