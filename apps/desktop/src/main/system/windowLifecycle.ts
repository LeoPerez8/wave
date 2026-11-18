/** The native window's lifetime is separate from the playback runtime's. */
export const createWindowLifecycle = (port: {
  readonly visible: () => boolean;
  readonly hide: () => void;
  readonly show: () => void;
  readonly quit: () => void;
  readonly closeQuits: () => boolean;
  readonly noticed: () => boolean;
  readonly rememberNotice: () => void;
  readonly notice: () => Promise<unknown>;
}) => {
  let quitting = false;
  return {
    show: port.show,
    toggle: () => (port.visible() ? port.hide() : port.show()),
    beginQuit: () => {
      quitting = true;
    },
    close: (event: { readonly preventDefault: () => void }) => {
      if (quitting) return;
      event.preventDefault();
      if (port.closeQuits()) {
        port.quit();
        return;
      }
      port.hide();
      if (!port.noticed()) {
        port.rememberNotice();
        void port.notice().catch(() => undefined);
      }
    },
  };
};
