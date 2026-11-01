import { existsSync } from "node:fs";
import { join } from "node:path";

const CERTIFICATE = "./certs/certificate.pem";

/**
 * The app config that makes an APK run only updates CI signed (docs/spec.md, Build and CI), once
 * the owner has committed the certificate. Until then prebuild, which fails on a certificate path
 * with no file, builds an APK that doesn't check signatures.
 */
export const updateSigning = (projectRoot: string) =>
  existsSync(join(projectRoot, CERTIFICATE))
    ? {
        codeSigningCertificate: CERTIFICATE,
        codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" as const },
      }
    : {};
