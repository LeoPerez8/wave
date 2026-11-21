import type { ScanState } from "./LibraryScan";

/**
 * The scan as `ScanProgressBanner` shows it, or null while it shows nothing:
 * no scan, a finished one, or an incremental rescan still looking or with no
 * files to read. The banner follows only this, so an incremental rescan's
 * count of files found re-renders nothing (#1423).
 */
export const scanBannerScan = (scan: ScanState): ScanState | null => {
  if (scan.status === "failed") return scan;
  if (scan.status !== "scanning") return null;
  if (scan.kind === "full") return scan;
  return scan.phase === "reading" && scan.filesFound - scan.filesUnchanged > 0 ? scan : null;
};
