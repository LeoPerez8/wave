/**
 * Library › Playlists › Import Playlists › From YT Music (docs/spec.md,
 * "Importing playlists from a link"): signed out, it signs in first (the
 * sign-in Settings › Accounts uses), then a full-screen sheet rises with the
 * playlists in the account's YouTube Music library. Core decides the rows,
 * the ticks and Select All (`ytLibraryPicker`); Import makes the playlists
 * and reads them in the background (`importYtLibrary`). Cancel, Back or
 * dragging the sheet down imports nothing.
 */
import {
  pressYtLibrarySelectAll,
  settleSheet,
  toggleYtLibraryRow,
  ytLibraryFailure,
  ytLibraryPicker,
  ytLibraryPickerView,
  type YtLibraryFailure,
  type YtLibraryPicker as Picker,
  type YtLibraryRow,
} from "@wave/core";
import * as Result from "effect/Result";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, FlatList, Modal, Text, useWindowDimensions, View } from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { Artwork } from "@/catalog/Artwork";
import { CheckCell } from "@/catalog/CheckCell";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { makeExternalStore } from "@/lib/externalStore";
import { Press } from "@/motion/Press";
import { showError, showMessage } from "@/overlay/alert";
import { useThemeColor } from "@/theme/useThemeColor";
import { askYtMusic } from "@/ytmusic/askYtMusic";

import { currentYtLibraryOrigins, importYtLibrary } from "./ytLibraryImport";

// ---------------------------------------------------------------------------
// Entry

/** Whether the picker is up (`YtLibraryPickerHost` draws it). */
const shown = makeExternalStore(false);

const SIGN_IN_FAILED: Record<"offline" | "failed", string> = {
  offline: "Couldn't sign in without a connection.",
  failed: "YouTube didn't confirm the sign-in. Try again.",
};

/**
 * Opens YouTube Music's sign-in page; true once signed in. Backing out of it
 * is false with nothing said; a sign-in that didn't work says why.
 */
const signIn = async (): Promise<boolean> => {
  const result = await askYtMusic((ytMusic) => ytMusic.signIn);
  if (Result.isFailure(result)) {
    const reason = result.failure.reason === "offline" ? "offline" : "failed";
    void showMessage("Couldn't sign in", SIGN_IN_FAILED[reason]);
    return false;
  }
  return result.success?.status === "signedIn";
};

/**
 * From YT Music: the picker, once signed in. Signed out (or the session
 * expired), the sign-in opens first; leaving it opens nothing.
 */
export const openYtLibraryImport = async (): Promise<void> => {
  const session = await askYtMusic((ytMusic) => ytMusic.session);
  const signedIn = Result.isSuccess(session) && session.success.status === "signedIn";
  if (signedIn || (await signIn())) shown.set(true);
};

/** Draws the picker while it's up; mounted once at the root. */
export function YtLibraryPickerHost() {
  const open = useSyncExternalStore(shown.subscribe, shown.get);
  const close = useCallback(() => shown.set(false), []);
  return open ? <PickerSheet onClosed={close} /> : null;
}

// ---------------------------------------------------------------------------
// Reading the library

type LibraryRead =
  | { readonly status: "reading" }
  | { readonly status: "read"; readonly picker: Picker }
  | { readonly status: "failed"; readonly reason: YtLibraryFailure };

const READING: LibraryRead = { status: "reading" };

const readLibrary = async (): Promise<LibraryRead> => {
  const answer = await askYtMusic((ytMusic) => ytMusic.libraryPlaylists);
  return Result.isFailure(answer)
    ? { status: "failed", reason: answer.failure.reason }
    : { status: "read", picker: ytLibraryPicker(answer.success, await currentYtLibraryOrigins()) };
};

// ---------------------------------------------------------------------------
// The sheet

/** Quick, with a little give and no wobble (as Now Playing's). */
const SPRING = { damping: 30, stiffness: 300, mass: 1 } as const;

/** Downward travel before a drag on the header takes over from a tap, in dp. */
const DRAG_SLOP = CELL * 1.5;

const COVER = CELL * 6;

/**
 * The picker: rises from the bottom as it opens, reads the library (again on
 * Try Again), and goes back down on Cancel, Back, a drag down or Import.
 */
function PickerSheet({ onClosed }: { onClosed: () => void }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const accent = useThemeColor("accent");
  const offset = useSharedValue(height);
  const start = useSharedValue(0);
  const leaving = useRef(false);

  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{ readonly attempt: number; readonly read: LibraryRead }>();
  const read: LibraryRead = answer?.attempt === attempt ? answer.read : READING;

  useEffect(() => {
    offset.set(withSpring(0, SPRING));
  }, [offset]);

  useEffect(() => {
    let current = true;
    void readLibrary().then((next) => {
      if (current) setAnswer({ attempt, read: next });
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  /** Slides the sheet away, then runs [then] (Import) once it has gone. */
  const leave = useCallback(
    (then?: () => void) => {
      if (leaving.current) return;
      leaving.current = true;
      const gone = () => {
        onClosed();
        then?.();
      };
      offset.set(
        withSpring(height, SPRING, (finished) => {
          if (finished === true) scheduleOnRN(gone);
        }),
      );
    },
    [height, offset, onClosed],
  );

  /** A drag down let go [at] dp below open: dismiss the sheet, importing nothing, or spring back. */
  const release = useCallback(
    (at: number, velocity: number) => {
      if (settleSheet({ from: "open", offset: at, velocity, height }) === "closed") leave();
      else offset.set(withSpring(0, { ...SPRING, velocity }));
    },
    [height, leave, offset],
  );

  const pan = usePanGesture({
    activeOffsetY: [-1_000_000, DRAG_SLOP],
    failOffsetX: [-DRAG_SLOP * 2, DRAG_SLOP * 2],
    onActivate: () => {
      "worklet";
      start.set(offset.get());
    },
    onUpdate: (event) => {
      "worklet";
      offset.set(Math.max(0, start.get() + event.translationY));
    },
    onDeactivate: (event) => {
      "worklet";
      scheduleOnRN(release, Math.max(0, start.get() + event.translationY), event.velocityY);
    },
  });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));

  const setPicker = (change: (picker: Picker) => Picker) =>
    setAnswer((last) =>
      last?.read.status === "read"
        ? { ...last, read: { status: "read", picker: change(last.read.picker) } }
        : last,
    );

  const view = read.status === "read" ? ytLibraryPickerView(read.picker) : null;

  const importTicked = () => {
    if (read.status !== "read" || view?.canImport !== true) return;
    const picker = read.picker;
    leave(() => {
      void importYtLibrary(picker).catch((error: unknown) =>
        showError("Couldn't import the playlists", error),
      );
    });
  };

  const signInAgain = () => {
    void signIn().then((signedIn) => {
      if (signedIn) setAttempt((n) => n + 1);
    });
  };

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => leave()}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View
          accessibilityViewIsModal
          className="flex-1 bg-background"
          style={[{ paddingTop: insets.top, paddingBottom: insets.bottom }, sheetStyle]}
        >
          <GestureDetector gesture={pan}>
            <View style={{ paddingHorizontal: grid.margin }}>
              <View className="items-center" style={{ paddingVertical: CELL }}>
                <View className="rounded-full bg-fill" style={{ width: CELL * 5, height: 5 }} />
              </View>
              <View className="flex-row items-center justify-between">
                <TextButton label="Cancel" onPress={() => leave()} />
                <Text
                  accessibilityRole="header"
                  className="font-sans text-body font-medium text-foreground"
                >
                  From YT Music
                </Text>
                {/* Balances Cancel, so the title sits in the middle. */}
                <View style={{ width: CELL * 7 }} />
              </View>
              {view?.selectAll != null && (
                <View className="flex-row justify-end">
                  <TextButton
                    label={view.selectAll}
                    onPress={() => setPicker(pressYtLibrarySelectAll)}
                  />
                </View>
              )}
            </View>
          </GestureDetector>
          <Hairline />

          <View className="flex-1">
            {read.status === "reading" && (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator
                  size="large"
                  color={accent}
                  accessibilityLabel="Reading your YouTube Music library"
                />
              </View>
            )}
            {read.status === "failed" && (
              <Failure
                reason={read.reason}
                tryAgain={() => setAttempt((n) => n + 1)}
                signIn={signInAgain}
              />
            )}
            {read.status === "read" && (
              // Never empty: Liked Songs is always listed.
              <FlatList
                data={read.picker.rows}
                keyExtractor={(row) => row.playlistId}
                renderItem={({ item }) => (
                  <PickerRow
                    row={item}
                    toggle={() =>
                      setPicker((picker) => toggleYtLibraryRow(picker, item.playlistId))
                    }
                  />
                )}
                contentContainerStyle={{ paddingVertical: CELL }}
              />
            )}
          </View>

          <Hairline />
          <View className="items-center" style={{ paddingVertical: CELL }}>
            <TextButton label="Import" onPress={importTicked} disabled={view?.canImport !== true} />
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * A playlist the picker lists: its tick, cover, name, "N songs" and, when
 * imported on this phone before, Imported. A tap ticks or unticks it.
 */
function PickerRow({ row, toggle }: { row: YtLibraryRow; toggle: () => void }) {
  const label = [row.title, row.line, row.imported ? "Imported" : null]
    .filter((part) => part !== null)
    .join(", ");
  return (
    <Press
      accessibilityRole="checkbox"
      accessibilityState={{ checked: row.ticked }}
      accessibilityLabel={label}
      onPress={toggle}
      haptic="selection"
    >
      <View
        className="flex-row items-center"
        style={{
          minHeight: grid.row + CELL,
          paddingLeft: grid.margin - CELL,
          paddingRight: grid.margin,
          gap: CELL * 1.5,
        }}
      >
        <CheckCell checked={row.ticked} />
        <Artwork uri={row.artworkUrl ?? undefined} size={COVER} radius={CELL / 2} />
        <View className="flex-1" style={{ gap: CELL / 4 }}>
          <Text numberOfLines={1} className="font-sans text-body text-foreground">
            {row.title}
          </Text>
          {row.line !== null && (
            <Text numberOfLines={1} className="font-sans text-subheadline text-secondary">
              {row.line}
            </Text>
          )}
        </View>
        {row.imported && (
          <Text className="font-sans text-subheadline text-secondary">Imported</Text>
        )}
      </View>
    </Press>
  );
}

/** Why the library wasn't read (Core's `ytLibraryFailure`), with Try Again or Sign In Again. */
function Failure({
  reason,
  tryAgain,
  signIn: signInAgain,
}: {
  reason: YtLibraryFailure;
  tryAgain: () => void;
  signIn: () => void;
}) {
  const { line, action } = ytLibraryFailure(reason);
  return (
    <View
      className="flex-1 items-center justify-center"
      style={{ padding: grid.margin, gap: CELL }}
    >
      <Text
        accessibilityLiveRegion="polite"
        className="text-center font-sans text-subheadline text-secondary"
      >
        {line}
      </Text>
      {action === "tryAgain" && <TextButton label="Try Again" onPress={tryAgain} />}
      {action === "signIn" && <TextButton label="Sign In Again" onPress={signInAgain} />}
    </View>
  );
}
