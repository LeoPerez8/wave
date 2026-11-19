import assert from "node:assert/strict";
import { test } from "node:test";
import { message, parseMessage, stringDict } from "./secretService.ts";

/** Reads the DESTINATION (header field 6) out of a built method-call message. */
const destinationOf = (buf: Buffer): string | null => {
  const fieldsLen = buf.readUInt32LE(12);
  let o = 16;
  const end = 16 + fieldsLen;
  let dest: string | null = null;
  while (o < end) {
    o = Math.ceil(o / 8) * 8; // struct alignment
    const code = buf[o++];
    const sigLen = buf[o++] as number;
    const sig = buf.toString("ascii", o, o + sigLen);
    o += sigLen + 1;
    if (sig === "s" || sig === "o") {
      o = Math.ceil(o / 4) * 4;
      const len = buf.readUInt32LE(o);
      o += 4;
      const s = buf.toString("utf8", o, o + len);
      o += len + 1;
      if (code === 6) dest = s;
    } else if (sig === "g") {
      const len = buf[o++] as number;
      o += len + 1;
    } else throw new Error(`unexpected header sig ${sig}`);
  }
  return dest;
};

test("Hello is addressed to the bus daemon; other calls default to the Secret Service", () => {
  const hello = message(1, {
    path: "/org/freedesktop/DBus",
    iface: "org.freedesktop.DBus",
    member: "Hello",
    dest: "org.freedesktop.DBus",
  });
  assert.equal(destinationOf(hello), "org.freedesktop.DBus");
  const getSecret = message(2, {
    path: "/item",
    iface: "org.freedesktop.Secret.Item",
    member: "GetSecret",
  });
  assert.equal(destinationOf(getSecret), "org.freedesktop.secrets");
});

test("a method call is a well-formed little-endian D-Bus header padded to 8", () => {
  const m = message(1, {
    path: "/org/freedesktop/DBus",
    iface: "org.freedesktop.DBus",
    member: "Hello",
  });
  assert.equal(m[0], 0x6c); // little-endian
  assert.equal(m[1], 1); // METHOD_CALL
  assert.equal(m[3], 1); // protocol version
  assert.equal(m.readUInt32LE(4), 0); // no body
  assert.equal(m.readUInt32LE(8), 1); // serial
  assert.equal(m.length % 8, 0); // body starts 8-aligned
});

test("stringDict pads the entries onto an 8-byte boundary (the a{ss} alignment)", () => {
  const body = stringDict("application", "brave");
  // uint32 content length, then 4 bytes of pad, then the first entry's string length.
  const contentLen = body.readUInt32LE(0);
  assert.equal(body.readUInt32LE(4), 0, "the 4 pad bytes are zero");
  assert.equal(body.readUInt32LE(8), "application".length, "first key length sits at offset 8");
  assert.equal(body.length, 8 + contentLen);
});

test("parseMessage reads a reply's serial and body, and reports an incomplete buffer", () => {
  // A method call round-trips through the header parser (calls carry no reply-serial).
  const body = Buffer.from([1, 2, 3, 4]);
  const call = message(42, {
    path: "/x",
    iface: "i.x",
    member: "M",
    signature: "ay",
    body,
  });
  assert.equal(parseMessage(call.subarray(0, 8)), null, "a short buffer is not yet a message");
  const parsed = parseMessage(call);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.message.replySerial, null);
  assert.equal(parsed?.end, call.length);
  assert.deepEqual(parsed?.message.body, body);
});

test("parseMessage extracts the reply-serial from a header field", () => {
  // Build a method_return (type 2) whose only header field is REPLY_SERIAL(5) = 7, with no body.
  const le = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0);
    return b;
  };
  // field a(yv): code 5, variant signature "u", value uint32 7. Struct aligned to 8 (offset 0 ok).
  const field = Buffer.concat([
    Buffer.from([5]), // field code REPLY_SERIAL
    Buffer.from([1]), // signature length
    Buffer.from("u", "ascii"),
    Buffer.from([0]), // nul
    le(7), // uint32 value (already 4-aligned at offset 4)
  ]);
  const header = Buffer.concat([
    Buffer.from([0x6c, 2, 1, 1]), // le, METHOD_RETURN, flags, version
    le(0), // body length
    le(99), // serial
    le(field.length), // fields array length
    field,
  ]);
  const padded = Buffer.concat([header, Buffer.alloc((8 - (header.length % 8)) % 8)]);
  const parsed = parseMessage(padded);
  assert.equal(parsed?.message.type, 2);
  assert.equal(parsed?.message.replySerial, 7);
});
