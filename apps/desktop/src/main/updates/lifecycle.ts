import type { DesktopManifest } from "../../../../updates/src/desktopProtocol.ts";

type ReadyUpdate = { file: string; manifest: DesktopManifest };

const sameUpdate = (a: DesktopManifest, b: DesktopManifest | null): boolean =>
  b !== null &&
  a.serial === b.serial &&
  a.version === b.version &&
  a.sha512 === b.sha512 &&
  a.size === b.size &&
  a.rollback === b.rollback;

export const desktopUpdateLifecycle = (ports: {
  check: () => Promise<DesktopManifest | null>;
  download: (manifest: DesktopManifest) => Promise<string | undefined>;
  latest: () => Promise<DesktopManifest | null>;
  install: (update: ReadyUpdate) => Promise<void>;
  report: (error: unknown) => void;
}) => {
  let ready: ReadyUpdate | undefined;
  let checking = false;
  let closing = false;

  return {
    check: async () => {
      if (checking || closing) return;
      checking = true;
      try {
        const manifest = await ports.check();
        if (closing || (ready && sameUpdate(ready.manifest, manifest))) return;
        ready = undefined;
        if (!manifest) return;
        const file = await ports.download(manifest);
        if (file && !closing) ready = { file, manifest };
      } catch (error) {
        ports.report(error);
      } finally {
        checking = false;
      }
    },
    quit: async () => {
      if (closing) return;
      closing = true;
      const update = ready;
      ready = undefined;
      if (!update) return;
      try {
        if (sameUpdate(update.manifest, await ports.latest())) await ports.install(update);
      } catch (error) {
        ports.report(error);
      }
    },
  };
};
