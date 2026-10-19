import { createContext, useContext, useLayoutEffect, useRef } from "react";

/**
 * A view being drawn into a shared image (`writeViewPng`): the images inside
 * it report in, so the drawing can wait until every one has loaded.
 */
export interface ImageCapture {
  /** An image started loading. */
  readonly add: () => void;
  /** An image loaded, failed, or went away. */
  readonly settle: () => void;
}

/**
 * Set around a view that becomes a shared image. Inside it, catalog images
 * draw with React Native's `Image` (software bitmaps the snapshot's canvas
 * can draw, where expo-image's may be hardware ones) and report their loading.
 */
export const ImageCaptureContext = createContext<ImageCapture | null>(null);

/** Whether this view is drawn into a shared image (still: no entrance animations). */
export const useInCapture = (): boolean => useContext(ImageCaptureContext) !== null;

/**
 * For a catalog image showing `uri`: inside a capture, registers it as loading
 * and returns what its `onLoadEnd` calls; undefined outside one (or with no
 * image to load), where it draws as usual.
 */
export const useCapturedImage = (uri: string | null | undefined): (() => void) | undefined => {
  const capture = useContext(ImageCaptureContext);
  const settled = useRef(false);
  const loading = capture !== null && uri !== null && uri !== undefined;
  useLayoutEffect(() => {
    if (!loading) return;
    settled.current = false;
    capture.add();
    return () => {
      if (!settled.current) capture.settle();
    };
    // `uri` isn't read in here: a new image loads afresh, so it registers again.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [capture, loading, uri]);
  if (!loading) return undefined;
  return () => {
    if (settled.current) return;
    settled.current = true;
    capture.settle();
  };
};
