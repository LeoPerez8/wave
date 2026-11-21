import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { harness } from "../../sync/src/testing.ts";

/** Google's Desktop client the fake sync service accepts. */
export const GENIUS_E2E_CLIENT = "genius-e2e-client";

/** Genius's envelope around [response]. */
export const geniusReply = (response: object) => Response.json({ meta: { status: 200 }, response });

/**
 * The real sync service in memory behind a local HTTP server, with Genius answered by
 * [answer]. `state` holds what the test changes (offline, failing, a held answer) and the
 * Genius routes the app asked.
 */
export async function fakeGeniusService(answer: (url: URL) => Response) {
  const service = await harness({ googleDesktopClientId: GENIUS_E2E_CLIENT });
  const state = {
    offline: false,
    fail: false,
    wait: Promise.resolve(),
    routes: [] as string[],
    aborted: 0,
  };
  service.upstream.answer = (href) => answer(new URL(href));

  const server = createServer((request, reply) => {
    void (async () => {
      const path = request.url ?? "/";
      if (path.startsWith("/v1/genius/")) {
        state.routes.push(path);
        request.on("aborted", () => {
          state.aborted += 1;
        });
        await state.wait;
        if (state.fail) return void reply.writeHead(503).end();
      }
      if (state.offline) return void reply.writeHead(503).end();
      if (path === "/token") {
        const idToken = await service.google.idToken({ aud: GENIUS_E2E_CLIENT, name: "Ana" });
        return void reply
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ id_token: idToken }));
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString("utf8");
      const headers: Record<string, string> = {};
      for (const name of ["authorization", "content-type"]) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const answer = await service.request(request.method ?? "GET", path, {
        headers,
        ...(body ? { body } : {}),
      });
      reply
        .writeHead(answer.status, Object.fromEntries(answer.headers))
        .end(Buffer.from(await answer.arrayBuffer()));
    })().catch(() => {
      if (!reply.headersSent) reply.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    state,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
