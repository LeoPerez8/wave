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
      details: object,
    ) => void,
  ) => void;
  readonly setPermissionCheckHandler: (
    handler: (
      contents: Contents | null,
      permission: string,
      origin: string,
      details: object,
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

/**
 * Installs the guard on the window's session. Every other permission keeps Electron's answer;
 * the camera, a screen's picture and the microphone outside Recognize are refused.
 */
export const guardCapture = <Contents, Source>(
  session: PermissionSession<Contents, Source>,
  guard: CaptureGuard<Contents, Source>,
): void => {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission !== "media") return callback(true);
    const { mediaTypes } = details as { readonly mediaTypes?: readonly string[] };
    callback(guard.trusted(contents) && audioOnly(mediaTypes) && guard.allows("microphone"));
  });
  session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (permission !== "media") return true;
    const { mediaType } = details as { readonly mediaType?: string };
    return guard.trusted(contents) && mediaType === "audio" && guard.allows("microphone");
  });
  session.setDisplayMediaRequestHandler((request, callback) => {
    if (!guard.loopback || !guard.trustedFrame(request.frame) || !guard.allows("systemAudio"))
      return callback({});
    void guard.screen().then(
      (screen) => callback(screen === undefined ? {} : { video: screen, audio: "loopback" }),
      () => callback({}),
    );
  });
};
