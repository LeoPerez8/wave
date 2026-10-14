/**
 * The PC bridge to Wave's Soulseek client, against a fake server and peer on
 * localhost (the same exchanges as SoulseekClientTest.kt). Needs a JDK
 * (JAVA_HOME) and the Kotlin compiler in Gradle's cache; skipped without them.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { connectSoulseek, findToolchain } from "./soulseek.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  join(
    here,
    "../../apps/mobile/modules/wave-native/android/src/test/resources/fixtures/soulseek-320.mp3",
  ),
);
const toolchain = findToolchain();
const LOCALHOST = 0x7f000001;

/** Little-endian Soulseek fields. */
class Fields {
  private readonly parts: Buffer[] = [];
  byte(value: number): this {
    this.parts.push(Buffer.from([value]));
    return this;
  }
  uint(value: number): this {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value);
    this.parts.push(buffer);
    return this;
  }
  ulong(value: number): this {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(BigInt(value));
    this.parts.push(buffer);
    return this;
  }
  string(value: string): this {
    const bytes = Buffer.from(value, "utf8");
    return this.uint(bytes.length).bytes(bytes);
  }
  bytes(value: Buffer): this {
    this.parts.push(value);
    return this;
  }
  result(): Buffer {
    return Buffer.concat(this.parts);
  }
}

const message = (code: number, body: Buffer, byteCode = false): Buffer => {
  const head = new Fields().uint(body.length + (byteCode ? 1 : 4));
  return Buffer.concat([(byteCode ? head.byte(code) : head.uint(code)).result(), body]);
};

/** Reads whole messages and raw bytes from a socket. */
const reader = (socket: Socket) => {
  let buffered = Buffer.alloc(0);
  let wake: (() => void) | null = null;
  socket.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    wake?.();
  });
  const take = async (count: number): Promise<Buffer> => {
    while (buffered.length < count) await new Promise<void>((resolve) => (wake = resolve));
    const taken = buffered.subarray(0, count);
    buffered = buffered.subarray(count);
    return taken;
  };
  return {
    take,
    read: async (byteCode = false) => {
      const length = (await take(4)).readUInt32LE();
      const body = await take(length);
      return byteCode
        ? { code: body[0]!, payload: body.subarray(1) }
        : { code: body.readUInt32LE(), payload: body.subarray(4) };
    },
  };
};

const fields = (payload: Buffer) => {
  let at = 0;
  return {
    uint: () => {
      at += 4;
      return payload.readUInt32LE(at - 4);
    },
    string: () => {
      const length = payload.readUInt32LE(at);
      at += 4 + length;
      return payload.subarray(at - length, at).toString("utf8");
    },
  };
};

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)),
  );

/** A Soulseek server and one peer sharing [fixture] as `Music\Fixture Artist\Fixture Title.mp3`. */
const fakeSoulseek = async (options: { readonly acceptLogin: boolean }) => {
  const seen = { login: [] as string[], shared: null as Buffer | null, queries: [] as string[] };
  let client: Socket | null = null;
  const filename = "Music\\Fixture Artist\\Fixture Title.mp3";
  let searchToken = 0;
  const peer = createServer(async (socket) => {
    const wire = reader(socket);
    const init = await wire.read(true);
    if (init.code === 0 && fields(init.payload).uint() === 77) {
      const result = new Fields()
        .string("fixture-peer")
        .uint(searchToken)
        .uint(1)
        .byte(1)
        .string(filename)
        .ulong(fixture.length)
        .string("")
        .uint(2)
        .uint(0)
        .uint(320)
        .uint(1)
        .uint(2)
        .byte(1)
        .uint(100_000)
        .uint(0)
        .result();
      socket.write(message(9, deflateSync(result)));
    } else if (init.code === 1) {
      const queue = await wire.read();
      const wanted = fields(queue.payload).string();
      await wire.read(); // place in queue
      socket.write(
        message(40, new Fields().uint(1).uint(1234).string(wanted).ulong(fixture.length).result()),
      );
      await wire.read(); // allowed
      client?.write(
        message(
          18,
          new Fields()
            .string("fixture-peer")
            .string("F")
            .uint(LOCALHOST)
            .uint(peerPort)
            .uint(56)
            .byte(0)
            .result(),
        ),
      );
    } else if (init.code === 0) {
      socket.write(new Fields().uint(1234).result());
      await wire.take(8); // offset
      socket.end(fixture);
    }
  });
  const peerPort = await listen(peer);
  const server = createServer(async (socket) => {
    client = socket;
    const wire = reader(socket);
    const login = fields((await wire.read()).payload);
    seen.login.push(login.string(), login.string());
    if (!options.acceptLogin) {
      socket.write(message(1, new Fields().byte(0).string("INVALIDPASS").result()));
      return;
    }
    socket.write(
      message(1, new Fields().byte(1).string("Welcome").uint(0).string("").byte(0).result()),
    );
    await wire.read(); // listen port
    seen.shared = (await wire.read()).payload;
    for (;;) {
      const next = await wire.read();
      const body = fields(next.payload);
      if (next.code === 26) {
        searchToken = body.uint();
        seen.queries.push(body.string());
        socket.write(
          message(
            18,
            new Fields()
              .string("fixture-peer")
              .string("P")
              .uint(LOCALHOST)
              .uint(peerPort)
              .uint(77)
              .byte(0)
              .result(),
          ),
        );
      } else if (next.code === 3) {
        socket.write(
          message(3, new Fields().string(body.string()).uint(LOCALHOST).uint(peerPort).result()),
        );
      }
    }
  });
  const port = await listen(server);
  return {
    port,
    seen,
    filename,
    close: () => {
      client?.destroy();
      server.close();
      peer.close();
    },
  };
};

describe("connectSoulseek", { skip: typeof toolchain === "string" && toolchain }, () => {
  const work = mkdtempSync(join(tmpdir(), "wave-soulseek-"));
  after(() => rmSync(work, { recursive: true, force: true }));

  it(
    "logs in, shares nothing, searches and downloads a checked 320 kbps file",
    { timeout: 120_000 },
    async () => {
      const fake = await fakeSoulseek({ acceptLogin: true });
      const session = await connectSoulseek({
        username: "wave-fixture",
        password: "fixture-secret",
        host: "127.0.0.1",
        port: fake.port,
      });
      try {
        assert.deepEqual(fake.seen.login, ["wave-fixture", "fixture-secret"]);
        assert.deepEqual(fake.seen.shared, new Fields().uint(0).uint(0).result());
        const found = await session.search("Fixture Artist Fixture Title");
        assert.deepEqual(fake.seen.queries, ["Fixture Artist Fixture Title"]);
        assert.deepEqual(found, [
          {
            username: "fixture-peer",
            filename: fake.filename,
            bytes: fixture.length,
            bitrateKbps: 320,
            durationMs: 2000,
            freeSlot: true,
            uploadSpeed: 100_000,
            queueLength: 0,
          },
        ]);
        const part = join(work, "part.mp3");
        assert.deepEqual(await session.download(found[0]!, part, 1541), { ok: true });
        assert.deepEqual(readFileSync(part), fixture);
      } finally {
        session.close();
        fake.close();
      }
    },
  );

  it("refuses a file whose duration isn't the recording's", { timeout: 120_000 }, async () => {
    const fake = await fakeSoulseek({ acceptLogin: true });
    const session = await connectSoulseek({
      username: "wave-fixture",
      password: "fixture-secret",
      host: "127.0.0.1",
      port: fake.port,
    });
    try {
      const [found] = await session.search("Fixture Title");
      const got = await session.download(found!, join(work, "other.mp3"), 9000);
      assert.deepEqual(got, {
        ok: false,
        reason: "The received recording has a different duration",
      });
    } finally {
      session.close();
      fake.close();
    }
  });

  it("fails when Soulseek rejects the login", { timeout: 120_000 }, async () => {
    const fake = await fakeSoulseek({ acceptLogin: false });
    await assert.rejects(
      connectSoulseek({
        username: "wave-fixture",
        password: "wrong",
        host: "127.0.0.1",
        port: fake.port,
      }),
      /Soulseek login failed: Soulseek rejected the account/,
    );
    fake.close();
  });
});
