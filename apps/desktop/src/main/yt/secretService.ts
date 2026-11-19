/**
 * Reading a browser's "Safe Storage" keyring password from the freedesktop Secret Service over
 * D-Bus, with no dependency and no external tool (`secret-tool` is often not installed). The app
 * speaks just enough of the D-Bus wire protocol to open a plain session, find the item stored under
 * the browser's `application` attribute, and read its secret. gnome-keyring and KWallet both serve
 * `org.freedesktop.secrets`, so this works on GNOME and KDE alike. Every failure yields null and
 * the sign-in falls back to its window, so this never blocks or breaks sign-in.
 *
 * The secret is returned to the caller and never logged. The wire code is deliberately small and
 * handles only the few D-Bus types these four calls use.
 */
import { createConnection, type Socket } from "node:net";
import { userInfo } from "node:os";

const SECRETS = "org.freedesktop.secrets";
const SERVICE_PATH = "/org/freedesktop/secrets";
const DEFAULT_TIMEOUT_MS = 3_000;

/** Marshals D-Bus values, little-endian, with each type on its alignment. */
class Writer {
  private buf = Buffer.alloc(0);
  get length(): number {
    return this.buf.length;
  }
  get bytes(): Buffer {
    return this.buf;
  }
  align(n: number): void {
    const pad = (n - (this.buf.length % n)) % n;
    if (pad) this.buf = Buffer.concat([this.buf, Buffer.alloc(pad)]);
  }
  byte(v: number): void {
    this.buf = Buffer.concat([this.buf, Buffer.from([v & 0xff])]);
  }
  uint32(v: number): void {
    this.align(4);
    const t = Buffer.alloc(4);
    t.writeUInt32LE(v >>> 0);
    this.buf = Buffer.concat([this.buf, t]);
  }
  string(s: string): void {
    this.uint32(Buffer.byteLength(s));
    this.buf = Buffer.concat([this.buf, Buffer.from(s, "utf8"), Buffer.from([0])]);
  }
  signature(s: string): void {
    this.byte(Buffer.byteLength(s));
    this.buf = Buffer.concat([this.buf, Buffer.from(s, "utf8"), Buffer.from([0])]);
  }
  raw(b: Buffer): void {
    this.buf = Buffer.concat([this.buf, b]);
  }
}

/** Unmarshals the few D-Bus shapes these calls return. */
class Reader {
  private readonly buf: Buffer;
  offset: number;
  constructor(buf: Buffer, offset = 0) {
    this.buf = buf;
    this.offset = offset;
  }
  private align(n: number): void {
    this.offset = Math.ceil(this.offset / n) * n;
  }
  byte(): number {
    return this.buf[this.offset++] ?? 0;
  }
  uint32(): number {
    this.align(4);
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }
  string(): string {
    const len = this.uint32();
    const s = this.buf.toString("utf8", this.offset, this.offset + len);
    this.offset += len + 1;
    return s;
  }
  signature(): string {
    const len = this.byte();
    const s = this.buf.toString("utf8", this.offset, this.offset + len);
    this.offset += len + 1;
    return s;
  }
  /** A `ay` byte array. */
  byteArray(): Buffer {
    this.align(4);
    const len = this.uint32();
    const v = Buffer.from(this.buf.subarray(this.offset, this.offset + len));
    this.offset += len;
    return v;
  }
  /** An `ao` array of object paths. */
  objectPaths(): string[] {
    this.align(4);
    const len = this.uint32();
    const end = this.offset + len;
    const paths: string[] = [];
    while (this.offset < end) paths.push(this.string());
    this.offset = end;
    return paths;
  }
  /** Skips a variant whose inner type is one these replies actually carry. */
  skipVariant(): void {
    const sig = this.signature();
    if (sig === "s" || sig === "o") this.string();
    else if (sig === "ay") this.byteArray();
    else if (sig === "g") this.signature();
    else throw new Error(`unsupported variant ${sig}`);
  }
  structAlign(): void {
    this.align(8);
  }
}

interface MethodCall {
  readonly path: string;
  readonly iface?: string;
  readonly member: string;
  /** The bus name the call is addressed to; the Secret Service for every call but the first Hello,
   *  which must go to the bus daemon itself. */
  readonly dest?: string;
  readonly signature?: string;
  readonly body?: Buffer;
}

/** A D-Bus `METHOD_CALL` message. [serial] identifies its reply. Exported for the wire tests. */
export const message = (serial: number, m: MethodCall): Buffer => {
  const w = new Writer();
  w.byte(0x6c); // little-endian
  w.byte(1); // METHOD_CALL
  w.byte(0); // flags
  w.byte(1); // protocol version
  w.uint32(m.body ? m.body.length : 0);
  w.uint32(serial);
  const fields = new Writer();
  const field = (code: number, sig: string, write: (x: Writer) => void) => {
    fields.align(8);
    fields.byte(code);
    fields.signature(sig);
    write(fields);
  };
  field(1, "o", (x) => x.string(m.path));
  if (m.iface !== undefined) field(2, "s", (x) => x.string(m.iface as string));
  field(3, "s", (x) => x.string(m.member));
  field(6, "s", (x) => x.string(m.dest ?? SECRETS));
  if (m.signature !== undefined) field(8, "g", (x) => x.signature(m.signature as string));
  w.uint32(fields.length);
  w.raw(fields.bytes);
  w.align(8);
  if (m.body) w.raw(m.body);
  return w.bytes;
};

interface ParsedMessage {
  readonly type: number;
  readonly replySerial: number | null;
  readonly errorName: string | null;
  readonly body: Buffer;
}

/** The first whole D-Bus message in [data], or null when it is not all there yet. Exported for the
 *  wire tests. */
export const parseMessage = (data: Buffer): { message: ParsedMessage; end: number } | null => {
  if (data.length < 16) return null;
  const header = new Reader(data);
  header.byte();
  const type = header.byte();
  header.byte();
  header.byte();
  const bodyLen = header.uint32();
  header.uint32(); // serial
  const fieldsLen = header.uint32();
  const headerEnd = Math.ceil((16 + fieldsLen) / 8) * 8;
  const total = headerEnd + bodyLen;
  if (data.length < total) return null;
  const fr = new Reader(data, 16);
  const fieldsEnd = 16 + fieldsLen;
  let replySerial: number | null = null;
  let errorName: string | null = null;
  while (fr.offset < fieldsEnd) {
    fr.structAlign();
    const code = fr.byte();
    const sig = fr.signature();
    if (code === 5) replySerial = fr.uint32();
    else if (code === 4) errorName = fr.string();
    else if (sig === "s" || sig === "o") fr.string();
    else if (sig === "g") fr.signature();
    else if (sig === "u") fr.uint32();
    else if (sig === "y") fr.byte();
    else throw new Error(`unsupported header field ${sig}`);
  }
  return {
    message: { type, replySerial, errorName, body: data.subarray(headerEnd, total) },
    end: total,
  };
};

/** A connected, authenticated D-Bus session that answers one call at a time. */
class DbusSession {
  private serial = 1;
  private acc = Buffer.alloc(0);
  private wake: (() => void)[] = [];
  private readonly sock: Socket;
  private constructor(sock: Socket) {
    this.sock = sock;
    sock.on("data", (d) => {
      this.acc = Buffer.concat([this.acc, d]);
      this.wake.splice(0).forEach((f) => f());
    });
  }

  static async open(timeoutMs: number): Promise<DbusSession> {
    const address = process.env["DBUS_SESSION_BUS_ADDRESS"] ?? "";
    const m = /unix:(path|abstract)=([^,]+)/.exec(address);
    if (m === null) throw new Error("no unix session bus");
    const target = m[1] === "abstract" ? `\0${m[2]}` : (m[2] as string);
    const sock = createConnection(target);
    sock.setTimeout(timeoutMs);
    sock.on("timeout", () => sock.destroy(new Error("D-Bus timeout")));
    const session = new DbusSession(sock);
    await new Promise<void>((resolve, reject) => {
      sock.once("connect", resolve);
      sock.once("error", reject);
    });
    // SASL EXTERNAL with the user's uid.
    sock.write(Buffer.from([0]));
    sock.write(`AUTH EXTERNAL ${Buffer.from(String(userInfo().uid)).toString("hex")}\r\n`);
    await session.untilAuthLine();
    if (!session.acc.toString("latin1").startsWith("OK")) throw new Error("D-Bus auth refused");
    session.acc = Buffer.alloc(0);
    sock.write("BEGIN\r\n");
    await session.call({
      path: "/org/freedesktop/DBus",
      iface: "org.freedesktop.DBus",
      member: "Hello",
      dest: "org.freedesktop.DBus",
    });
    return session;
  }

  private more(): Promise<void> {
    return new Promise((resolve) => this.wake.push(resolve));
  }

  private async untilAuthLine(): Promise<void> {
    while (!/\r\n/.test(this.acc.toString("latin1"))) await this.more();
  }

  async call(m: MethodCall): Promise<Buffer> {
    const serial = this.serial++;
    this.sock.write(message(serial, m));
    for (;;) {
      let parsed = parseMessage(this.acc);
      while (parsed !== null) {
        this.acc = this.acc.subarray(parsed.end);
        if (parsed.message.replySerial === serial) {
          if (parsed.message.type === 3) throw new Error(`D-Bus error ${parsed.message.errorName}`);
          return parsed.message.body;
        }
        parsed = parseMessage(this.acc);
      }
      await this.more();
    }
  }

  close(): void {
    this.sock.destroy();
  }
}

/** The dict body `a{ss}` of one `{key: value}` pair, padded so the entries land on 8. Exported for
 *  the wire tests. */
export const stringDict = (key: string, value: string): Buffer => {
  const entries = new Writer();
  entries.string(key);
  entries.string(value);
  const body = new Writer();
  body.uint32(entries.length);
  body.align(8);
  body.raw(entries.bytes);
  return body.bytes;
};

/**
 * The "Safe Storage" password a Chromium browser stored in the keyring under [application]
 * (`brave`, `chrome`, `chromium`, `microsoft-edge`), or null when the Secret Service has no such
 * item or cannot be reached. Never throws.
 */
export const readSafeStorageSecret = async (
  application: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string | null> => {
  let session: DbusSession | undefined;
  try {
    session = await Promise.race([
      DbusSession.open(timeoutMs),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("D-Bus open timeout")), timeoutMs),
      ),
    ]);

    // OpenSession("plain", variant(""))
    const openArgs = new Writer();
    openArgs.string("plain");
    openArgs.signature("s");
    openArgs.string("");
    const openReply = new Reader(
      await session.call({
        path: SERVICE_PATH,
        iface: "org.freedesktop.Secret.Service",
        member: "OpenSession",
        signature: "sv",
        body: openArgs.bytes,
      }),
    );
    openReply.skipVariant();
    const sessionPath = openReply.string();

    // SearchItems({ application })
    const searchReply = new Reader(
      await session.call({
        path: SERVICE_PATH,
        iface: "org.freedesktop.Secret.Service",
        member: "SearchItems",
        signature: "a{ss}",
        body: stringDict("application", application),
      }),
    );
    const unlocked = searchReply.objectPaths();
    const locked = searchReply.objectPaths();
    if (unlocked.length === 0 && locked.length > 0) {
      const toUnlock = new Writer();
      const list = new Writer();
      for (const path of locked) list.string(path);
      toUnlock.uint32(list.length);
      toUnlock.raw(list.bytes);
      await session
        .call({
          path: SERVICE_PATH,
          iface: "org.freedesktop.Secret.Service",
          member: "Unlock",
          signature: "ao",
          body: toUnlock.bytes,
        })
        .catch(() => undefined);
    }
    const item = unlocked[0] ?? locked[0];
    if (item === undefined) return null;

    // GetSecret(session) -> (oayays): session, params, value, content-type
    const secretArgs = new Writer();
    secretArgs.string(sessionPath);
    const secretReply = new Reader(
      await session.call({
        path: item,
        iface: "org.freedesktop.Secret.Item",
        member: "GetSecret",
        signature: "o",
        body: secretArgs.bytes,
      }),
    );
    secretReply.structAlign();
    secretReply.string(); // session
    secretReply.byteArray(); // params
    const value = secretReply.byteArray();
    return value.toString("utf8");
  } catch {
    return null;
  } finally {
    session?.close();
  }
};
