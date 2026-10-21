import { IconX } from "@tabler/icons-react-native";
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CELL, grid } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";

/** The room a share preview has to fit its image into. */
interface PreviewArea {
  readonly width: number;
  readonly height: number;
}

/**
 * A share preview's frame, over everything: Close at the top, then the area
 * the image is fitted into, measured, with [renderPreview] drawn in it once
 * it has room; [children] goes under it (the destinations row).
 */
export function SharePreviewFrame({
  onClose,
  renderPreview,
  children,
}: {
  onClose: () => void;
  renderPreview: (area: PreviewArea) => ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [area, setArea] = useState<PreviewArea | null>(null);
  const preview = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    if (preview.current !== null)
      AccessibilityInfo.sendAccessibilityEvent(preview.current, "focus");
  }, []);

  return (
    <View
      ref={preview}
      accessibilityViewIsModal
      accessibilityLabel="Share preview"
      className="bg-background"
      style={[
        StyleSheet.absoluteFill,
        { paddingTop: insets.top, paddingBottom: insets.bottom + CELL * 3 },
      ]}
    >
      <View
        className="flex-row items-center"
        style={{ height: CELL * 7, paddingHorizontal: grid.margin - 12 }}
      >
        <IconButton icon={IconX} label="Close" onPress={onClose} />
      </View>
      <View
        className="flex-1 items-center justify-center"
        style={{ paddingHorizontal: grid.margin * 2, paddingVertical: CELL * 2 }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setArea({ width: width - grid.margin * 4, height: height - CELL * 4 });
        }}
      >
        {area !== null && area.width > 0 && area.height > 0 && renderPreview(area)}
      </View>
      {children}
    </View>
  );
}
