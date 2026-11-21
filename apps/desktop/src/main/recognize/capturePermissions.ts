/**
 * What the window may capture: audio only, only for the session Recognize is capturing, only
 * from Wave's own page. Main decides here; the renderer stays sandboxed and asks the browser
 * the ordinary way (`getUserMedia`, `getDisplayMedia`).
 */

/** The part of Electron's `Session` the guard uses. */
export interface PermissionSession<Contents, Source> {
  readonly setPermissionRequestHandler: (
    handler: (
      contents: Contents,
      permission: string,
      callback: (granted: boolean) => void,
      details: { readonly isMainFrame: boolean; readonly mediaTypes?: readonly string[] },
    ) => void,
  ) => void;
  readonly setPermissionCheckHandler: (
    handler: (
      contents: Contents | null,
      permission: string,
      origin: string,
      details: { readonly isMainFrame: boolean; readonly mediaType?: string },
    ) => boolean,
  ) => void;
  readonly setDisplayMediaRequestHandler: (
    handler: (
      request: { readonly frame?: unknown },
      callback: (streams: { video?: Source; audio?: "loopback" }) => void,
    ) => void,
  ) => void;
}

export interface CaptureGuard<Contents, Source> {
  /** Whether [contents] is Wave's main window. */
  readonly trusted: (contents: Contents | null) => boolean;
  /** Whether a display capture's [frame] is the main window's page. */
  readonly trustedFrame: (frame: unknown) => boolean;
  /** Whether Recognize is capturing [kind] now (`RecognizeShape.allows`). */
  readonly allows: (kind: "microphone" | "systemAudio") => boolean;
  /**
   * The screen a display capture is made of, for its loopback audio: the window drops the
   * picture at once. Undefined where the system has none.
   */
  readonly screen: () => Promise<Source | undefined>;
  /** Whether the system captures what it plays as a display capture's audio (Windows). */
  readonly loopback: boolean;
}

/** Whether a request for [mediaTypes] is audio and nothing else. */
const audioOnly = (mediaTypes: readonly string[] | undefined): boolean =>
  mediaTypes !== undefined && mediaTypes.length > 0 && mediaTypes.every((type) => type === "audio");

/** Recognize is the only feature that needs renderer permissions. */
export const guardCapture = <Contents, Source>(
  session: PermissionSession<Contents, Source>,
  guard: CaptureGuard<Contents, Source>,
): void => {
  const loopbackAllowed = () => guard.loopback && guard.allows("systemAudio");
  session.setPermissionRequestHandler(
    (contents, permission, callback, { isMainFrame, mediaTypes }) => {
      if (!isMainFrame || !guard.trusted(contents)) return callback(false);
      if (permission === "display-capture")
        return callback(mediaTypes?.includes("audio") === true && loopbackAllowed());
      callback(permission === "media" && audioOnly(mediaTypes) && guard.allows("microphone"));
    },
  );
  session.setPermissionCheckHandler((contents, permission, _origin, { isMainFrame, mediaType }) => {
    if (!isMainFrame || !guard.trusted(contents)) return false;
    if (permission === "display-capture") return loopbackAllowed();
    return permission === "media" && mediaType === "audio" && guard.allows("microphone");
  });
  session.setDisplayMediaRequestHandler((request, callback) => {
    if (!guard.trustedFrame(request.frame) || !loopbackAllowed()) return callback({});
    void guard.screen().then(
      (screen) => callback(screen === undefined ? {} : { video: screen, audio: "loopback" }),
      () => callback({}),
    );
  });
};
