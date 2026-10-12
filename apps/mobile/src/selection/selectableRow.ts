import type { MenuOptions } from "@/playback/ActionsMenu";

import type { ListSelection } from "./useListSelection";

/** What a row or tile in a selectable list takes from `selectableRow`. */
export interface SelectableRowProps {
  /** Set while selecting: the row shows its check. */
  readonly checked: boolean | undefined;
  readonly onPress: () => void;
  readonly onLongPress: () => void;
}

/** While selecting, a long-press does nothing (rather than toggling the row on release). */
const ignoreLongPress = (): void => undefined;

/**
 * How a row in a selectable list behaves: a tap runs [open] and a long-press
 * opens its menu ([openMenu], offered Select when the list can select);
 * while the list is selecting, the row shows a check and taps toggle it.
 * Spread the result onto the row: `<TrackRow {...selectableRow(…)} />`.
 */
export const selectableRow = <T>(
  item: T,
  selection: ListSelection<T> | undefined,
  open: () => void,
  openMenu: (options: MenuOptions) => void,
): SelectableRowProps => {
  if (selection?.selecting === true)
    return {
      checked: selection.isChecked(item),
      onPress: () => selection.toggle(item),
      onLongPress: ignoreLongPress,
    };
  return {
    checked: undefined,
    onPress: open,
    onLongPress: () =>
      openMenu(selection === undefined ? {} : { onSelect: () => selection.start(item) }),
  };
};
