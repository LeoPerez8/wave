import type { AutoNode } from "@/native/wavePlayer";
import type { ServicesStart } from "@/services";

import type { AutoAnswer } from "./autoResponder";

/**
 * The spike's browse tree (#31), answered by JS so Auto proves the headless
 * runtime is up: a root with one "Wave" tab holding a status line. #32
 * replaces it with Core's Auto browse model.
 */
const ROOT: AutoNode = { mediaId: "root", title: "Wave", browsable: true, playable: false };
const TAB: AutoNode = { mediaId: "spike", title: "Wave", browsable: true, playable: false };

const status = (start: ServicesStart | null): AutoNode => {
  return {
    mediaId: "spike/status",
    title: start === null ? "Services not started" : `Started by the ${start.by}`,
    subtitle:
      start === null
        ? undefined
        : `${start.calls} start call${start.calls === 1 ? "" : "s"}, ${Math.round(
            (Date.now() - start.at) / 1000,
          )} s ago`,
    browsable: true,
    playable: false,
  };
};

/** Answers with the status of `startServices`, read through [servicesStart]. */
export const placeholderAnswer =
  (servicesStart: () => ServicesStart | null): AutoAnswer =>
  async (request) => {
    if (request.type === "root") return ROOT;
    const { parentId } = JSON.parse(request.payload) as { parentId: string };
    if (parentId === ROOT.mediaId) return [TAB];
    if (parentId === TAB.mediaId) return [status(servicesStart())];
    return [];
  };
