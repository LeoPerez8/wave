// Authenticode can change the PE checksum and certificate directory, and can add
// zero padding before the 8-byte aligned certificate table at the end of the file.
function peFields(file: Buffer) {
  if (file.length < 64 || file.toString("ascii", 0, 2) !== "MZ")
    throw new Error("Expected a Windows executable");
  const header = file.readUInt32LE(60);
  const optional = header + 24;
  if (header < 64 || optional + 2 > file.length || file.readUInt32LE(header) !== 0x4550)
    throw new Error("Invalid PE header");
  const magic = file.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error("Invalid PE optional header");
  const directory = optional + (magic === 0x20b ? 112 : 96);
  const certificate = directory + 4 * 8;
  const headerEnd = optional + file.readUInt16LE(header + 20);
  if (
    certificate + 8 > headerEnd ||
    headerEnd > file.length ||
    file.readUInt32LE(directory - 4) < 5
  )
    throw new Error("Missing PE certificate directory");
  return { checksum: optional + 64, certificate, headerEnd };
}

export function verifyAuthenticodePayload(unsigned: Buffer, signed: Buffer) {
  const { checksum, certificate, headerEnd } = peFields(unsigned);
  const signedFields = peFields(signed);
  if (signedFields.checksum !== checksum || signedFields.certificate !== certificate)
    throw new Error("SignPath changed the PE payload");
  if (unsigned.readBigUInt64LE(certificate) !== 0n)
    throw new Error("SignPath input already has a PE certificate");
  const offset = signed.readUInt32LE(certificate);
  const size = signed.readUInt32LE(certificate + 4);
  const padding = offset - unsigned.length;
  if (
    offset < headerEnd ||
    offset % 8 ||
    padding < 0 ||
    padding > 7 ||
    size < 8 ||
    offset + size !== signed.length ||
    signed.subarray(unsigned.length, offset).some((byte) => byte !== 0)
  )
    throw new Error("Invalid returned PE certificate table");
  if (
    !unsigned.subarray(0, checksum).equals(signed.subarray(0, checksum)) ||
    !unsigned
      .subarray(checksum + 4, certificate)
      .equals(signed.subarray(checksum + 4, certificate)) ||
    !unsigned.subarray(certificate + 8).equals(signed.subarray(certificate + 8, unsigned.length))
  )
    throw new Error("SignPath changed the PE payload");
}
