/**
 * The little of the Chrome DevTools Protocol YouTube's sign-in needs (`ytBrowserSignIn.ts`):
 * commands over the browser's WebSocket, each waiting for its answer. Node's global `WebSocket`
 * is the socket; a test passes its own.
 */

/** The part of a `WebSocket` the protocol uses. */
export interface CdpSocket {
  readonly send: (text: string) => void;
  readonly close: () => void;
  readonly addEventListener: (
    type: "open" | "message" | "error" | "close",
    listener: (event: { readonly data?: unknown }) => void,
  ) => void;
}

export interface Cdp {
  /** Runs [method]; with [sessionId], on that page. Fails when the browser does, or is gone. */
  readonly send: (
    method: string,
    params?: Readonly<Record<string, unknown>>,
    sessionId?: string,
  ) => Promise<Record<string, unknown>>;
  readonly close: () => void;
}

interface Waiting {
  readonly resolve: (result: Record<string, unknown>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const GONE = "The browser's DevTools connection closed";

/** The protocol over [socket], once it is open; a command without an answer in [timeoutMs] fails. */
export const openCdp = (socket: CdpSocket, timeoutMs = 10_000): Promise<Cdp> =>
  new Promise((opened, refused) => {
    const waiting = new Map<number, Waiting>();
    let nextId = 1;
    let closed = false;
    const end = () => {
      closed = true;
      refused(new Error(GONE));
      for (const [id, command] of waiting) {
        waiting.delete(id);
        clearTimeout(command.timer);
        command.reject(new Error(GONE));
      }
    };
    socket.addEventListener("error", end);
    socket.addEventListener("close", end);
    socket.addEventListener("message", (event) => {
      let message: { id?: unknown; result?: unknown; error?: { message?: unknown } };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }
      if (typeof message.id !== "number") return;
      const command = waiting.get(message.id);
      if (command === undefined) return;
      waiting.delete(message.id);
      clearTimeout(command.timer);
      if (message.error !== undefined)
        command.reject(new Error(`DevTools: ${String(message.error.message)}`));
      else command.resolve((message.result ?? {}) as Record<string, unknown>);
    });
    socket.addEventListener("open", () =>
      opened({
        send: (method, params = {}, sessionId) =>
          new Promise((resolve, reject) => {
            if (closed) {
              reject(new Error(GONE));
              return;
            }
            const id = nextId++;
            const timer = setTimeout(() => {
              waiting.delete(id);
              reject(new Error(`DevTools: no answer to ${method}`));
            }, timeoutMs);
            waiting.set(id, { resolve, reject, timer });
            socket.send(
              JSON.stringify({
                id,
                method,
                params,
                ...(sessionId === undefined ? {} : { sessionId }),
              }),
            );
          }),
        close: () => {
          if (!closed) socket.close();
        },
      }),
    );
  });
