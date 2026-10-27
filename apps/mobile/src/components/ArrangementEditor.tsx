import { IconMinus, IconPlus } from "@tabler/icons-react-native";
import type { ComponentType, ReactNode } from "react";
import { ScrollView, Text, View, type AccessibilityActionEvent } from "react-native";
import Animated from "react-native-reanimated";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import {
  ReorderHandle,
  useReorderRow,
  useRowReorder,
  type RowReorder,
} from "@/components/RowReorder";
import { TextButton } from "@/components/TextButton";
import { IconButton } from "@/components/IconButton";

const ROW = grid.row;
/** A 48dp target for each of a row's buttons. */
const BUTTON = CELL * 6;

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/** A change made in an arrangement editor (Core's `HomeArrangementEdit`, `TabBarEdit`). */
export type ArrangementEdit<Id> =
  | { readonly remove: Id }
  | { readonly add: Id }
  /** An item dragged from one place among those shown to another (0-based). */
  | { readonly move: { readonly from: number; readonly to: number } };

/** A row's button: add or remove the item. */
function RowButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <IconButton
      icon={Icon}
      iconSize={20}
      strokeWidth={1.75}
      size={BUTTON}
      label={label}
      disabled={disabled}
      disabledTone="secondary"
      onPress={onPress}
      style={{ opacity: disabled ? 0.4 : 1 }}
    />
  );
}

/**
 * An item's title, and under it [detail] when there is one ("Needs YT
 * Music"). Large text wraps them and the row grows to fit.
 */
function RowLabel({ title, detail = null }: { title: string; detail?: string | null }) {
  return (
    <View className="flex-1" style={{ paddingVertical: CELL / 2 }}>
      <Text className="font-sans text-body text-foreground">{title}</Text>
      {detail !== null && <Text className="font-sans text-footnote text-secondary">{detail}</Text>}
    </View>
  );
}

/**
 * A row's line: at least a row tall (its hairline included), taller where
 * large text or a wrapping title needs it.
 */
const ROW_BOX = { minHeight: ROW } as const;
/** The row's content fills it above the hairline, centred. */
const ROW_LINE = { flexGrow: 1 } as const;

/**
 * A row the owner can't drag, above or below those they can: Home on the tab
 * bar (nothing to press), or Search, whose pill stays at the end (a button
 * takes it off when [onRemove] is given).
 */
export function FixedRow({
  title,
  place,
  onRemove,
  divider,
}: {
  title: string;
  /** Where the item sits, for the remove button's label: "Home", "the tab bar". */
  place: string;
  onRemove?: () => void;
  divider: boolean;
}) {
  return (
    <View style={ROW_BOX}>
      <View className="flex-row items-center" style={ROW_LINE}>
        <RowLabel title={title} />
        {onRemove !== undefined && (
          <View style={{ marginRight: -CELL * 1.5 }}>
            <RowButton
              icon={IconMinus}
              label={`Remove ${title} from ${place}`}
              onPress={onRemove}
            />
          </View>
        )}
      </View>
      {divider && <Hairline />}
    </View>
  );
}

type ShownRowProps<Id> = {
  id: Id;
  title: string;
  detail: string | null;
  place: string;
  index: number;
  count: number;
  /** Draw a hairline under the last row too (a fixed row follows). */
  divideLast: boolean;
  reorder: RowReorder<Id>;
  edit: (edit: ArrangementEdit<Id>) => void;
};

/**
 * An item shown: its title, a button that takes it off, and a handle to drag
 * it up or down. Screen readers get Move up / Move down / Remove.
 */
function ShownRow<Id>({
  id,
  title,
  detail,
  place,
  index,
  count,
  divideLast,
  reorder,
  edit,
}: ShownRowProps<Id>) {
  const { style, underline, handle } = useReorderRow({ index, reorder });

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const action = event.nativeEvent.actionName;
    if (action === "moveUp") edit({ move: { from: index, to: index - 1 } });
    else if (action === "moveDown") edit({ move: { from: index, to: index + 1 } });
    else if (action === "remove") edit({ remove: id });
  };

  return (
    <Animated.View
      onLayout={(event) => reorder.measure(id, event.nativeEvent.layout.height)}
      style={[ROW_BOX, style]}
    >
      <View
        accessible
        accessibilityLabel={title}
        accessibilityActions={[
          ...(index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
          ...(index < count - 1 ? [{ name: "moveDown", label: "Move down" }] : []),
          { name: "remove", label: `Remove from ${place}` },
        ]}
        onAccessibilityAction={onAccessibilityAction}
        className="flex-row items-center"
        style={ROW_LINE}
      >
        <RowLabel title={title} detail={detail} />
        <RowButton
          icon={IconMinus}
          label={`Remove ${title} from ${place}`}
          onPress={() => edit({ remove: id })}
        />
        <ReorderHandle gesture={handle} />
      </View>
      {(divideLast || index < count - 1) && (
        <Animated.View style={underline}>
          <Hairline />
        </Animated.View>
      )}
    </Animated.View>
  );
}

/** An item not shown, with a button that adds it (off while nothing more fits). */
function HiddenRow<Id>({
  id,
  title,
  detail,
  place,
  divider,
  canAdd,
  edit,
}: {
  id: Id;
  title: string;
  detail: string | null;
  place: string;
  divider: boolean;
  canAdd: boolean;
  edit: (edit: ArrangementEdit<Id>) => void;
}) {
  return (
    <View style={ROW_BOX}>
      <View className="flex-row items-center" style={ROW_LINE}>
        <RowLabel title={title} detail={detail} />
        <View style={{ marginRight: -CELL * 1.5 }}>
          <RowButton
            icon={IconPlus}
            label={`Add ${title} to ${place}`}
            disabled={!canAdd}
            onPress={() => edit({ add: id })}
          />
        </View>
      </View>
      {divider && <Hairline />}
    </View>
  );
}

export type ArrangementEditorProps<Id extends string> = {
  /** The items shown that can be dragged, in order. */
  shown: readonly Id[];
  /** The items not shown, in the order they're offered. */
  hidden: readonly Id[];
  title: (id: Id) => string;
  /** A line under an item's title, or null for none: what it needs that's off. */
  detail?: (id: Id) => string | null;
  /** Where the items show, for buttons' labels: "Home", "the tab bar". */
  place: string;
  /** The heading over the items not shown, e.g. "Not on Home". */
  hiddenHeading: string;
  edit: (edit: ArrangementEdit<Id>) => void;
  /** Whether another item fits; while it doesn't, the add buttons are off. */
  canAdd?: boolean;
  /** A fixed row above the shown items (`FixedRow`). */
  first?: ReactNode;
  /** A fixed row below them (`FixedRow`). */
  last?: ReactNode;
  /** A line under the lists, e.g. what can't be changed. */
  note?: string;
  /**
   * The card's Done, which hands the arrangement back. Without it the editor
   * is a Settings page's content: it fills the page, within the page's
   * margins, and the caller saves each `edit` as it comes.
   */
  onDone?: (() => void) | undefined;
};

/** A Settings page's room around its content (`SettingsPageScreen`'s). */
const PAGE_CONTENT = { paddingHorizontal: grid.margin, paddingBottom: CELL * 6 } as const;

/**
 * An editor for an ordered set of items (Home's sections, the tab bar's
 * tabs), in a card or on a Settings page: the items shown (drag a handle to
 * reorder, a button removes one), then those not shown (a button adds one).
 * The caller keeps the arrangement and applies each `edit`; in a card, Done
 * hands it back. It scrolls, except while a row is dragged.
 */
export function ArrangementEditor<Id extends string>({
  shown,
  hidden,
  title,
  detail = () => null,
  place,
  hiddenHeading,
  edit,
  canAdd = true,
  first,
  last,
  note,
  onDone,
}: ArrangementEditorProps<Id>) {
  const reorder = useRowReorder({
    ids: shown,
    rowHeight: ROW,
    move: (from, to) => edit({ move: { from, to } }),
  });
  const count = shown.length;
  const empty = count === 0 && first === undefined && last === undefined;

  return (
    <>
      <View style={{ flexShrink: 1 }}>
        <ScrollView
          bounces={false}
          overScrollMode="never"
          scrollEnabled={!reorder.dragging}
          contentContainerStyle={onDone === undefined ? PAGE_CONTENT : undefined}
        >
          {first}
          {shown.map((id, index) => (
            <ShownRow
              key={id}
              id={id}
              title={title(id)}
              detail={detail(id)}
              place={place}
              index={index}
              count={count}
              divideLast={last !== undefined}
              reorder={reorder}
              edit={edit}
            />
          ))}
          {last}
          {hidden.length > 0 && (
            <View
              style={{ marginTop: empty ? 0 : CELL * 3, paddingBottom: CELL / 2 }}
              accessibilityRole="header"
            >
              <CatalogLine>{hiddenHeading}</CatalogLine>
            </View>
          )}
          {hidden.map((id, index) => (
            <HiddenRow
              key={id}
              id={id}
              title={title(id)}
              detail={detail(id)}
              place={place}
              divider={index < hidden.length - 1}
              canAdd={canAdd}
              edit={edit}
            />
          ))}
          {note !== undefined && (
            <Text className="mt-2 font-sans text-footnote text-secondary">{note}</Text>
          )}
        </ScrollView>
      </View>
      {onDone !== undefined && (
        <View className="flex-row justify-end" style={{ paddingTop: CELL }}>
          <TextButton label="Done" onPress={onDone} />
        </View>
      )}
    </>
  );
}
