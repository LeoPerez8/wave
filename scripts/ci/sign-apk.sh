#!/usr/bin/env bash
# Signs a release APK with Wave's release key and the rotation proof from the key APKs were
# signed with before it (docs/spec.md, APK signing). Only the release job runs it, in its
# channel's Environment, which holds the secrets. The Android job hands it an unsigned APK.
#   scripts/ci/sign-apk.sh <unsigned apk> <output apk>
# Env: ANDROID_HOME, WAVE_RELEASE_KEYSTORE (the PKCS12 keystore, base64; key alias `wave`),
# WAVE_RELEASE_KEYSTORE_PASSWORD (its store and key password), WAVE_SIGNING_LINEAGE (the
# rotation proof, base64).
set -euo pipefail

input="$(realpath "$1")"
output="$(realpath -m "$2")"
tools="$(ls -d "${ANDROID_HOME:?}"/build-tools/* | sort -V | tail -n 1)"

keys="$(umask 077 && mktemp -d)"
signed="$output.unchecked"
trap 'rm -rf "$keys" "$signed"' EXIT
base64 -d <<< "${WAVE_RELEASE_KEYSTORE:?}" > "$keys/release.p12"
base64 -d <<< "${WAVE_SIGNING_LINEAGE:?}" > "$keys/lineage"

# Signature scheme v3 only: Wave's minimum is Android 12, which reads it, and v1 and v2 would
# need the previous key too. With the rotation minimum at 31, every supported phone sees the
# release key and the proof, not just Android 13 and later.
mkdir -p "$(dirname "$output")"
"$tools/apksigner" sign --v1-signing-enabled false --v2-signing-enabled false \
  --v3-signing-enabled true --ks "$keys/release.p12" --ks-key-alias wave \
  --ks-pass env:WAVE_RELEASE_KEYSTORE_PASSWORD --key-pass env:WAVE_RELEASE_KEYSTORE_PASSWORD \
  --lineage "$keys/lineage" --rotation-min-sdk-version 31 --out "$signed" "$input"

# Wave's release key (ticket 14's, CN=Wave, O=Wave), and the key every release up to
# v0.58.0-ti was signed with: Expo's public debug key. The tests point these at their own keys.
release_signer="${WAVE_RELEASE_SIGNER_SHA256:-80cee0c33afc558f4b130433c78035bba0f966f1c8f0fce422f587e245fcde65}"
previous_signer="${WAVE_PREVIOUS_SIGNER_SHA256:-fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c}"

# The signed APK reaches <output> only once it checks out: one signer, the release key, and a
# proof that goes from the previous key, which may no longer roll back, to the release key.
# Without that proof phones on an earlier release refuse the APK; with rollback, a phone that
# took it would still install one signed with the public key.
fail() {
  echo "$1" >&2
  exit 1
}
verified="$("$tools/apksigner" verify -v --print-certs "$signed" | grep -v '^WARNING')"
signers="$(sed -n 's/^Number of signers: //p' <<< "$verified")"
signer="$(sed -n 's/^V3\.0 Signer: certificate SHA-256 digest: //p' <<< "$verified")"
if [ "$signers" != 1 ] || [ "$signer" != "$release_signer" ]; then
  fail "The APK isn't signed by the release key alone: $signers signer(s), v3 signer ${signer:-none}."
fi
proof="$("$tools/apksigner" lineage --in "$signed" --print-certs)"
chain="$(sed -n 's/^Signer #[0-9]* in lineage certificate SHA-256 digest: //p' <<< "$proof" | paste -sd ' ')"
if [ "$chain" != "$previous_signer $release_signer" ]; then
  fail "The rotation proof doesn't go from the previous key to the release key: ${chain:-none}."
fi
# The first signer's capabilities come first.
rollback="$(sed -n 's/^Has rollback capability *: //p' <<< "$proof" | head -n 1)"
if [ "$rollback" != false ]; then
  fail "The rotation proof is wrong: the previous key can still roll back."
fi
mv "$signed" "$output"
echo "Signed with the release key $release_signer, rotated from $previous_signer."
