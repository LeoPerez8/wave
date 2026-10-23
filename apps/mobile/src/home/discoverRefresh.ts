/** Refresh is offered on the named row heading, leaving its tiles individually focusable. */
export interface DiscoverRefresh {
  readonly label: string;
  readonly enabled: boolean;
  readonly run: () => void;
}

/** Native accessibility event adapter; the pull gesture and heading share the same callback. */
export const discoverRefreshAccessibility = (refresh?: DiscoverRefresh | undefined) => ({
  accessibilityActions: refresh?.enabled ? [{ name: "refresh", label: refresh.label }] : [],
  onAccessibilityAction: ({ nativeEvent }: { nativeEvent: { actionName: string } }): void => {
    if (nativeEvent.actionName === "refresh" && refresh?.enabled) refresh.run();
  },
});
